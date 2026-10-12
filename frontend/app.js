// The chat page. It only talks to our own web API; it knows nothing about Kubernetes.
//
// Text from the server is always placed with textContent, never innerHTML, so a log
// line or pod name can never be run as HTML by the browser.

const messagesElement = document.getElementById("messages");
const formElement = document.getElementById("message-form");
const inputElement = document.getElementById("message-input");
const sendButton = document.getElementById("send-button");
const nameElement = document.getElementById("user-name");
const environmentsElement = document.getElementById("environments");
const checkedElement = document.getElementById("status-checked");
const refreshButton = document.getElementById("refresh-button");

const PROGRESS_POLL_MS = 1000;

// ---- Who is talking ----

// sessionStorage belongs to one tab, so every tab gets its own conversation.
let sessionId = sessionStorage.getItem("sessionId");
if (!sessionId) {
  sessionId = crypto.randomUUID();
  sessionStorage.setItem("sessionId", sessionId);
}

// The name is the same in every tab; it is stored as "requested by" in the history.
nameElement.value = localStorage.getItem("userName") ?? "";
nameElement.addEventListener("change", () => {
  localStorage.setItem("userName", nameElement.value.trim());
});

// ---- Talking to the server ----

/** Calls our API. Returns the JSON body, or throws an Error with the server's own sentence. */
async function api(method, path, body) {
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Session-Id": sessionId,
        "X-User-Name": nameElement.value.trim(),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error("The Deployment Assistant server is not answering. Is it still running?");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error ?? `The server answered with status ${response.status}.`);
  }
  return data;
}

// ---- Drawing messages ----

const STATUS_WORDS = /\b(HEALTHY|DEGRADED|DOWN)\b/;

/** Fills an element with text, wrapping HEALTHY, DEGRADED and DOWN in a coloured label. */
function setTextWithStatusWords(element, text) {
  element.textContent = "";
  for (const part of text.split(STATUS_WORDS)) {
    if (STATUS_WORDS.test(part)) {
      const label = document.createElement("span");
      label.className = `status-word status-${part}`;
      label.textContent = part;
      element.append(label);
    } else {
      element.append(part);
    }
  }
}

function scrollToNewest() {
  messagesElement.scrollTop = messagesElement.scrollHeight;
}

function addMessage(role, text, isError = false) {
  const bubble = document.createElement("div");
  bubble.className = `message ${role}${isError ? " error" : ""}`;
  const body = document.createElement("div");
  setTextWithStatusWords(body, text);
  bubble.append(body);
  messagesElement.append(bubble);
  scrollToNewest();
  return bubble;
}

/** Shows an agent reply: its text, then Confirm and Cancel, or the progress of a change. */
function showReply(reply, options = { actionIsOpen: true }) {
  const bubble = addMessage("agent", reply.text);
  if (reply.action) {
    // The server keeps one pending change per tab. A new one replaces any older one,
    // so the older Confirm and Cancel buttons are switched off.
    for (const button of messagesElement.querySelectorAll(".action-buttons button")) {
      button.disabled = true;
    }
    addConfirmation(bubble, reply.action, options.actionIsOpen);
  }
  if (reply.operationId) {
    followOperation(bubble, reply.operationId);
  }
  scrollToNewest();
}

function addConfirmation(bubble, action, isOpen) {
  if (action.warning) {
    const warning = document.createElement("div");
    warning.className = "action-warning";
    warning.textContent = action.warning;
    bubble.append(warning);
  }

  const buttons = document.createElement("div");
  buttons.className = "action-buttons";
  const confirmButton = document.createElement("button");
  confirmButton.type = "button";
  confirmButton.className = "confirm-button";
  confirmButton.textContent = "Confirm";
  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.textContent = "Cancel";
  buttons.append(confirmButton, cancelButton);
  bubble.append(buttons);

  // An action that was already used (seen after a page reload) keeps its buttons, switched off.
  confirmButton.disabled = cancelButton.disabled = !isOpen;

  async function decide(choice) {
    // Switch both off at once, so a double click cannot send the choice twice.
    confirmButton.disabled = cancelButton.disabled = true;
    addMessage("user", choice === "confirm" ? "(clicked Confirm)" : "(clicked Cancel)");
    try {
      const { reply } = await api("POST", `/api/actions/${encodeURIComponent(action.id)}/${choice}`);
      showReply(reply);
    } catch (error) {
      addMessage("agent", error.message, true);
    }
  }
  confirmButton.addEventListener("click", () => decide("confirm"));
  cancelButton.addEventListener("click", () => decide("cancel"));
}

/**
 * Asks the server once a second how a running change is doing and updates one line.
 * The page stays usable meanwhile: this is a timer, not a waiting request.
 */
function followOperation(bubble, operationId) {
  const line = document.createElement("div");
  line.className = "progress";
  line.textContent = "Waiting for the first pod...";
  bubble.append(line);

  async function check() {
    let operation;
    try {
      ({ operation } = await api("GET", `/api/operations/${encodeURIComponent(operationId)}`));
    } catch (error) {
      line.textContent = error.message;
      return;
    }
    const trail = operation.steps.join("  ->  ");
    if (operation.state === "running") {
      line.textContent = trail === "" ? "Waiting for the first pod..." : `${trail} ...`;
      setTimeout(check, PROGRESS_POLL_MS);
      return;
    }
    // Finished: keep the steps that were seen, then show how it ended.
    line.textContent = trail === "" ? "" : `${trail}\n`;
    const result = document.createElement("span");
    result.className = `status-word status-${operation.state}`;
    result.textContent = operation.state === "succeeded" ? "DONE" : "FAILED";
    line.append(result, ` ${operation.message}`);
    scrollToNewest();
    refreshStatus();
  }
  check();
}

// ---- Sending a message ----

formElement.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = inputElement.value.trim();
  if (message === "") {
    return;
  }
  inputElement.value = "";
  addMessage("user", message);
  sendButton.disabled = true;
  try {
    const { reply } = await api("POST", "/api/chat", { message });
    showReply(reply);
  } catch (error) {
    addMessage("agent", error.message, true);
  } finally {
    sendButton.disabled = false;
    inputElement.focus();
  }
});

// ---- Status panel ----

function drawEnvironment(summary) {
  const card = document.createElement("div");
  card.className = "environment";

  const title = document.createElement("div");
  title.className = "environment-title";
  const name = document.createElement("span");
  name.textContent = summary.environment;
  const status = document.createElement("span");
  status.className = `status-word status-${summary.status.replace(" ", "-")}`;
  status.textContent = summary.status;
  title.append(name, status);
  card.append(title);

  const details = [
    `Image: ${summary.image ?? "none"}`,
    `Last update: ${summary.lastUpdate ? new Date(summary.lastUpdate).toLocaleString() : "no deployment recorded"}`,
  ];
  if (summary.reason) {
    details.push(summary.reason);
  }
  for (const text of details) {
    const line = document.createElement("p");
    line.className = "environment-detail";
    line.textContent = text;
    card.append(line);
  }
  return card;
}

async function refreshStatus() {
  refreshButton.disabled = true;
  try {
    const { environments, checkedAt } = await api("GET", "/api/status");
    environmentsElement.replaceChildren(...environments.map(drawEnvironment));
    checkedElement.textContent = `Checked at ${new Date(checkedAt).toLocaleTimeString()}`;
  } catch (error) {
    environmentsElement.replaceChildren();
    checkedElement.textContent = error.message;
  } finally {
    refreshButton.disabled = false;
  }
}

refreshButton.addEventListener("click", refreshStatus);

// ---- Start ----

/** Redraws this tab's conversation after a page reload. */
async function loadConversation() {
  try {
    const { messages, pendingActionId } = await api("GET", "/api/session");
    for (const message of messages) {
      if (message.role === "user") {
        addMessage("user", message.text);
      } else {
        showReply(message, { actionIsOpen: message.action?.id === pendingActionId });
      }
    }
    if (messages.length === 0) {
      addMessage("agent", 'Hello. Tell me what to do, for example "deploy sample-app version v2 to staging", or type "help".');
    }
  } catch (error) {
    addMessage("agent", error.message, true);
  }
}

loadConversation();
refreshStatus();
