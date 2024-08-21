(()=>{"use strict";var t={d:(e,n)=>{for(var i in n)t.o(n,i)&&!t.o(e,i)&&Object.defineProperty(e,i,{enumerable:!0,get:n[i]})},o:(t,e)=>Object.prototype.hasOwnProperty.call(t,e),r:t=>{"undefined"!=typeof Symbol&&Symbol.toStringTag&&Object.defineProperty(t,Symbol.toStringTag,{value:"Module"}),Object.defineProperty(t,"__esModule",{value:!0})}},e={};t.r(e),t.d(e,{activate:()=>i,deactivate:()=>r});const n=require("vscode");function i(t){const e=new o(t.extensionUri);t.subscriptions.push(n.window.registerWebviewViewProvider(o.viewType,e)),t.subscriptions.push(n.commands.registerCommand("extension.showD3Graph",((i={},o={})=>{const r=n.window.createWebviewPanel("d3Graph","D3 Graph",n.ViewColumn.One,{enableScripts:!0});r.webview.html=function(t,e,i,o){const r=t.asWebviewUri(n.Uri.joinPath(e,"media","graph.js"));return`<!DOCTYPE html>\n    <html lang="en">\n    <head>\n        <meta charset="UTF-8">\n        <meta name="viewport" content="width=device-width, initial-scale=1.0">\n        <title>D3 Directed Graph</title>\n        <style>\n            body {\n                margin: 0;\n                padding: 0;\n                overflow: hidden;\n            }\n            #graph {\n                width: 100vw;\n                height: 100vh;\n                border: 1px solid black;\n            }\n        </style>\n    </head>\n    <body>\n        <div id="graph">Loading...</div>\n        <script type="module">\n\t\t\tconst treeData = ${JSON.stringify(i)};\n\t\t\tconst activeNode = ${o};\n\t\t\tconst vscode = acquireVsCodeApi();\n            import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7/+esm';\n\n            // Load the external script and call createGraph function\n            const script = document.createElement('script');\n            script.type = 'module';\n            script.src = '${r}';\n            document.body.appendChild(script);\n\n            script.onload = () => {\n                import('${r}').then(module => {\n                    module.createGraph(treeData, vscode, activeNode);\n                });\n            };\n        <\/script>\n    </body>\n    </html>`}(r.webview,t.extensionUri,i,o),r.webview.onDidReceiveMessage((t=>{"updateActiveNode"===t.command&&(e.receiveInformation("activeNode",t.activeNode),r.dispose())}),void 0,t.subscriptions)})))}class o{constructor(t){this._extensionUri=t}resolveWebviewView(t,e,i){this._view=t,t.webview.options={enableScripts:!0,localResourceRoots:[this._extensionUri]},t.webview.html=this._getHtmlForWebview(t.webview),t.webview.onDidReceiveMessage((t=>{switch(t.type){case"showGraph":{const e=t.treeData,i=t.activeNode;n.commands.executeCommand("extension.showD3Graph",e,i);break}}}))}receiveInformation(t,e){var n;let i={type:t,data:e};null===(n=this._view)||void 0===n||n.webview.postMessage(i)}_getHtmlForWebview(t){const e=t.asWebviewUri(n.Uri.joinPath(this._extensionUri,"media","main.js")),i=t.asWebviewUri(n.Uri.joinPath(this._extensionUri,"media","reset.css")),o=t.asWebviewUri(n.Uri.joinPath(this._extensionUri,"media","vscode.css")),r=t.asWebviewUri(n.Uri.joinPath(this._extensionUri,"media","main.css")),s=function(){let t="";const e="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";for(let n=0;n<32;n++)t+=e.charAt(Math.floor(62*Math.random()));return t}();return`<!DOCTYPE html>\n\t\t\t<html lang="en">\n\t\t\t<head>\n\t\t\t\t<meta charset="UTF-8">\n\n\t\t\t\t\x3c!--\n\t\t\t\t\tUse a content security policy to only allow loading styles from our extension directory,\n\t\t\t\t\tand only allow scripts that have a specific nonce.\n\t\t\t\t\t(See the 'webview-sample' extension sample for img-src content security policy examples)\n\t\t\t\t--\x3e\n\t\t\t\t<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${t.cspSource}; script-src 'nonce-${s}';">\n\n\t\t\t\t<meta name="viewport" content="width=device-width, initial-scale=1.0">\n\n                <link href="${i}" rel="stylesheet">\n\t\t\t\t<link href="${o}" rel="stylesheet">\n\t\t\t\t<link href="${r}" rel="stylesheet">\n\n\t\t\t\t<title>Debug</title>\n\t\t\t</head>\n\t\t\t\t<body>\n\t\t\t\t<div class="new-bug">\n\t\t\t\t\t<label for="new-bug">New Bug:</label>\n\t\t\t\t\t<input type="text" id="new-bug" name="new-bug" />\n\t\t\t\t\t<br/>\n\t\t\t\t\t<button class="add-color-button">Start Session</button>\n\t\t\t\t</div>\n\t\t\t\t<br/>\n\t\t\t\t<hr/>\n\t\t\t\t<br/>\n\t\t\t\t<div class="new-attempt">\n\t\t\t\t\t<p>\n\t\t\t\t\t\t<b>Bug</b>: No text rendering on page.\n\t\t\t\t\t</p>\n\t\t\t\t\t<br/>\n\t\t\t\t\t<label for="new-attempt">Attempted Solution</label>\n\t\t\t\t\t<textarea name="attempt" cols="40" rows="5">\n\t\t\t\t\t</textarea>\n\t\t\t\t\t<br/>\n\t\t\t\t\t<button class="add-color-button">Add ?Checkpoint?</button>\n\t\t\t\t</div>\n\t\t\t\t<br/>\n\t\t\t\t<hr/>\n\t\t\t\t<br/>\n\t\t\t\t<button class="show-tree-button">Show D3 Graph</button>\n\t\t\t\t<br/>\n\t\t\t\t<ul class="color-list">\n\t\t\t\t</ul>\n\t\t\t\t<br/>\n\t\t\t\t<hr/>\n\t\t\t\t<br/>\n\t\t\t\t<p>\n\t\t\t\t<b>Bug</b>: No text rendering on page.\n\t\t\t\t</p>\n\t\t\t\t<br/>\n\t\t\t\t<div class="attempted-solution">\n\t\t\t\t\t<label for="attempt">Attempted Solution</label>\n\t\t\t\t\t<textarea name="attempt" cols="40" rows="5">Added print statements to the database call to check and see what data is being returned.?Should this be editable?\n\t\t\t\t\t</textarea>\n\t\t\t\t</div>\n\t\t\t\t<br/>\n\t\t\t\t<button class="meow-button">Restore ?Checkpoint?</button>\n\t\t\t\t<button class="delete-checkpoint-button">?Delete?</button>\n\t\n\t\t\t\t<script nonce="${s}" src="${e}"><\/script>\n\t\t\t\t<br/>\n\t\t\t\t<br/>\n\t\t\t\t</body>\n\t\t\t</html>`}}function r(){}o.viewType="debugPanel.panelView",module.exports=e})();