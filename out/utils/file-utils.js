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
exports.loadKnowledgeBase = loadKnowledgeBase;
exports.extractFiles = extractFiles;
exports.saveFile = saveFile;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const logger_1 = require("../logger");
function loadKnowledgeBase(root, kbRelPath) {
    const kbPath = path.join(root, kbRelPath);
    if (!fs.existsSync(kbPath)) {
        (0, logger_1.log)(`⚠  Knowledge base not found: ${kbPath}`);
        (0, logger_1.log)('   → Continuing without KB — output will be more generic.');
        return '';
    }
    const parts = [];
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
            }
            else if (/\.(md|txt)$/i.test(entry.name)) {
                try {
                    const content = fs.readFileSync(full, 'utf-8').trim();
                    if (content) {
                        const rel = path.relative(kbPath, full);
                        parts.push(`### [${rel}]\n${content}`);
                    }
                }
                catch { /* skip unreadable files */ }
            }
        }
    };
    walk(kbPath);
    (0, logger_1.log)(`✅ Knowledge base: ${parts.length} files loaded`);
    return parts.join('\n\n---\n\n');
}
function extractFiles(content) {
    const files = [];
    // Match: ### FILE: <path>\n```<lang?>\n<code>\n```
    const re = /###\s*FILE:\s*([^\n]+)\n```[^\n]*\n([\s\S]*?)```/g;
    let m;
    while ((m = re.exec(content)) !== null) {
        files.push({ filePath: m[1].trim(), code: m[2].trim() });
    }
    return files;
}
function saveFile(sessionDir, rel, content) {
    const full = path.join(sessionDir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
    return full;
}
