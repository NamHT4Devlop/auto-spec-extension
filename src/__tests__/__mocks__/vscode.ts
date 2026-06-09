/** Minimal vscode mock for unit testing outside VS Code */
export const window = {
  createOutputChannel: () => ({
    appendLine: () => {},
    append: () => {},
    show: () => {},
    dispose: () => {},
  }),
  showInputBox: jest.fn(),
  showQuickPick: jest.fn(),
  showInformationMessage: jest.fn(),
  showWarningMessage: jest.fn(),
  showErrorMessage: jest.fn(),
};

export const workspace = {
  getConfiguration: () => ({
    get: (key: string, defaultVal: any) => defaultVal,
  }),
  workspaceFolders: [],
};

export const Uri = {
  file: (p: string) => ({ fsPath: p, scheme: 'file' }),
};

export const ProgressLocation = { Notification: 15 };
export const ConfigurationTarget = { Global: 1 };

export const LanguageModelChatMessage = {
  User: (content: string) => ({ role: 'user', content }),
};

export const LanguageModelTextPart = class {
  constructor(public value: string) {}
};

export const lm = {
  selectChatModels: jest.fn().mockResolvedValue([]),
};

export const commands = {
  registerCommand: jest.fn(),
  executeCommand: jest.fn(),
};

export const CancellationTokenSource = class {
  token = { isCancellationRequested: false, onCancellationRequested: jest.fn() };
  cancel() { (this.token as any).isCancellationRequested = true; }
  dispose() {}
};

export const ViewColumn = { One: 1, Two: 2, Beside: -2 };
