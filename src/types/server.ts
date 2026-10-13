/** What the server says about itself once it is listening. */
export interface StartupFacts {
  /** Where the page is, for example "http://127.0.0.1:3000". */
  url: string;
  /** The kubeconfig context the server talks to. */
  context: string;
  environments: string[];
  /** One sentence about who reads the chat messages: OpenAI or the built-in rules. */
  reader: string;
  /** Things the user should act on, such as a page that is not built yet. */
  warnings: string[];
}
