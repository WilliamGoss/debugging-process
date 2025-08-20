import * as vscode from 'vscode';
import { getUri } from '../utils/getUri';
import { getNonce } from '../utils/getNonce';

export class CanvasViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'extension.canvasView';
  private _view?: vscode.WebviewView;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    const scriptUri = getUri(webviewView.webview, this._extensionUri, [
      'dist',
      'canvasApp.js',
    ]);

    const nonce = getNonce();

    webviewView.webview.html = this._getHtml(scriptUri, nonce);
  }

  private _getHtml(scriptUri: vscode.Uri, nonce: string) {
    return /* html */ `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta http-equiv="Content-Security-Policy"
          content="default-src 'none'; img-src ${this._view?.webview.cspSource} https:;
                   style-src ${this._view?.webview.cspSource} 'unsafe-inline'; 
                   script-src 'nonce-${nonce}';">
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>React MUI Webview</title>
      </head>
      <body>
        <div id="root"></div>
        <script nonce="${nonce}" src="${scriptUri}"></script>
      </body>
      </html>
    `;
  }
}
