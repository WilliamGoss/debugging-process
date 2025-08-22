import * as vscode from 'vscode';
import * as path from 'node:path';
import { spawn } from 'child_process';
import type { PythonExtension } from '@vscode/python-extension';

export async function getPythonInterpreter(uri?: vscode.Uri): Promise<string | undefined> {
  const pyExt = vscode.extensions.getExtension<PythonExtension>('ms-python.python');
  if (!pyExt) { return undefined; }               // optional dependency
  await pyExt.activate();

  const envApi = pyExt.exports.environments;
  const envPath = envApi.getActiveEnvironmentPath(uri);
  const info = await envApi.resolveEnvironment(envPath);
  return info?.executable?.uri?.fsPath ?? (info as any)?.executable?.command;
}

/** Truncate to max chars, appending an ellipsis note. */
function truncateByChars(s: string, maxChars: number) {
    if (s.length <= maxChars) return { text: s, truncated: false, omitted: 0 };
    const omitted = s.length - maxChars;
    return {
      text: s.slice(0, maxChars) + `\n… [${omitted} chars truncated]`,
      truncated: true,
      omitted,
    };
  }
  
  /** Keep head and tail; good for tracebacks (preserves start & final error). */
  function truncateHeadTail(s: string, headChars: number, tailChars: number) {
    if (s.length <= headChars + tailChars) {
      return { text: s, truncated: false, omitted: 0 };
    }
    const head = s.slice(0, headChars);
    const tail = s.slice(-tailChars);
    const omitted = s.length - headChars - tailChars;
    return {
      text: `${head}\n… [${omitted} chars truncated] …\n${tail}`,
      truncated: true,
      omitted,
    };
  }

type AutoCreateNodePayload = {
    stdout: string;
    stderr: string;
    code: number | null;
    signal: NodeJS.Signals | null;
  };

export async function runPythonScript(
    filePath: string,
    provider: { receiveInformation: (type: string, payload: string) => void },
    folderUri?: vscode.Uri
  ) {
    if (!vscode.workspace.isTrusted) {
      vscode.window.showWarningMessage('Trust this workspace to run Python scripts.');
      return;
    }
  
    const output = vscode.window.createOutputChannel('Debugger');
    output.clear();
    output.show(true);
  
    // Resolve interpreter (your existing logic)
    let pythonPath = await getPythonInterpreter(folderUri);
    if (!pythonPath) { pythonPath = process.platform === 'win32' ? 'py' : 'python3'; }
  
    // Use -u for unbuffered I/O so prints appear before errors
    const child = spawn(pythonPath, ['-u', filePath], {
      cwd: path.dirname(filePath),
      shell: false,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    });
  
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
  
    let stdoutAll = '';
    let stderrAll = '';
  
    child.stdout.on('data', (chunk: string) => {
      stdoutAll += chunk;
      output.append(chunk); // still show in Output panel
    });
  
    child.stderr.on('data', (chunk: string) => {
      stderrAll += chunk;
      output.append(chunk); // still show in Output panel
    });
  
    child.on('error', (err) => {
      const msg = `\nError launching Python: ${err.message}`;
      stderrAll += msg;
      output.appendLine(msg);
    });
  
    child.on('close', (code, signal) => {
        // Choose your limits
        const MAX_STDOUT = 20_000;          // chars
        const MAX_STDERR_HEAD = 8_000;      // chars from start
        const MAX_STDERR_TAIL = 4_000;      // chars from end

        const out = truncateByChars(stdoutAll, MAX_STDOUT);
        const err = truncateHeadTail(stderrAll, MAX_STDERR_HEAD, MAX_STDERR_TAIL);

        // Build one object with both streams + exit info
        const payload: AutoCreateNodePayload = {
            stdout: out.text,
            stderr: err.text,
            code: code ?? null,
            signal: (signal as NodeJS.Signals) ?? null,
      };
  
      // Send exactly ONE message with everything (stringify if your receiver expects a string)
      provider.receiveInformation('autoCreateNode', JSON.stringify(payload));
  
      output.appendLine(`\nProcess exited ${signal ? `with signal ${signal}` : `with code ${code}`}`);
    });
  }