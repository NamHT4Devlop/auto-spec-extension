"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.callCopilot = callCopilot;
const vscode = __importStar(require("vscode"));
const logger_1 = require("../logger");
async function callCopilot(model, systemContext, userPrompt, token, stepLabel) {
    (0, logger_1.log)(`\nℹ  AI › ${stepLabel} ...`);
    (0, logger_1.log)('·'.repeat(64));
    // vscode.lm doesn't have a separate "system" role for all models,
    // so we prepend the system context as a User turn.
    const messages = [
        vscode.LanguageModelChatMessage.User(`SYSTEM CONTEXT (follow strictly):\n${systemContext}\n\n---\n\nUSER REQUEST:\n${userPrompt}`),
    ];
    const response = await model.sendRequest(messages, {}, token);
    let result = '';
    for await (const chunk of response.stream) {
        if (chunk instanceof vscode.LanguageModelTextPart) {
            result += chunk.value;
            (0, logger_1.logRaw)(chunk.value); // stream to output channel in real-time
        }
    }
    // ensure newline after streaming
    const ch = (await Promise.resolve().then(() => __importStar(require('../logger')))).getChannel();
    ch.appendLine('');
    (0, logger_1.log)('·'.repeat(64));
    return result;
}
