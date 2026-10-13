import { Annotation, Command, END, interrupt, MemorySaver, START, StateGraph } from "@langchain/langgraph";

import { answerWizard } from "@/agent/serviceWizard.ts";
import { FLOW_LOST, MAX_OPEN_FLOWS } from "@/constants/wizard.ts";
import type { ServiceFlow, ServiceFlowDeps, WizardStep } from "@/types/wizard.ts";

// What the graph carries from one step to the next.
const FlowState = Annotation.Root({
  /** Where the questions are: the question that is open, or how they ended. */
  step: Annotation<WizardStep>(),
  /** The user's answer to the open question, on its way from "ask" to "check". */
  answer: Annotation<string>(),
});

type FlowStateType = typeof FlowState.State;

/**
 * The questions for creating or changing a service, as a LangGraph workflow:
 *
 *   START -> ask -> check -> ask ... (a question is open)
 *                        \-> END     (the settings are finished, or the user cancelled)
 *
 * "ask" pauses the graph and hands the open question to the chat. The graph continues
 * when the user's next message is passed back in as the answer. "check" runs the fixed
 * rules of serviceWizard.ts on it. No language model is part of this graph, so an
 * answer never leaves the machine.
 *
 * LangGraph keeps the state of every conversation between two messages (its
 * checkpointer), under the conversation's own name, the thread.
 */
export function createServiceFlow(deps: ServiceFlowDeps): ServiceFlow {
  const maxOpen = deps.maxOpen ?? MAX_OPEN_FLOWS;
  // Kept in memory, like the chat sessions: a restart ends the open conversations.
  const checkpointer = new MemorySaver();
  /** The conversations that wait for an answer, oldest first. */
  const open = new Set<string>();

  /** Pauses here with the open question. On the way back in, interrupt() returns the user's answer. */
  function ask(state: FlowStateType): Partial<FlowStateType> {
    const answer: unknown = interrupt(state.step);
    return { answer: String(answer) };
  }

  /** Checks the answer: the same question again, the next question, or the end. */
  function check(state: FlowStateType): Partial<FlowStateType> {
    if (state.step.kind !== "ask") {
      // "ask" only ever hands over an open question.
      return {};
    }
    return { step: answerWizard(state.step.wizard, state.answer, deps.context()) };
  }

  const graph = new StateGraph(FlowState)
    .addNode("ask", ask)
    .addNode("check", check)
    .addEdge(START, "ask")
    .addEdge("ask", "check")
    // A question is open: ask it. Otherwise the questions are over.
    .addConditionalEdges("check", (state) => (state.step.kind === "ask" ? "ask" : END), ["ask", END])
    .compile({ checkpointer });

  const configFor = (thread: string) => ({ configurable: { thread_id: thread } });

  /** Forgets a conversation: its state is removed from the checkpointer. */
  async function close(thread: string): Promise<void> {
    open.delete(thread);
    await checkpointer.deleteThread(thread);
  }

  /** What a run of the graph came to: the question it paused at, or the step it ended with. */
  async function outcomeOf(thread: string, result: FlowStateType & { __interrupt__?: { value?: unknown }[] }) {
    const paused = result.__interrupt__?.[0]?.value as WizardStep | undefined;
    if (paused !== undefined) {
      return paused;
    }
    await close(thread);
    return result.step;
  }

  return {
    async start(thread, first) {
      open.add(thread);
      // A conversation nobody answers any more must not stay in memory for ever.
      for (const oldest of open) {
        if (open.size <= maxOpen) {
          break;
        }
        await close(oldest);
      }
      return outcomeOf(thread, await graph.invoke({ step: first }, configFor(thread)));
    },

    async answer(thread, text) {
      if (!open.has(thread)) {
        return { kind: "cancelled", text: FLOW_LOST };
      }
      // Command({ resume }) continues the paused graph and gives the text to interrupt().
      return outcomeOf(thread, await graph.invoke(new Command({ resume: text }), configFor(thread)));
    },
  };
}
