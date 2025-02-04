import * as vscode from 'vscode';
import * as git from "isomorphic-git";
import fs from 'fs';
import * as path from 'path';

let graphView: vscode.WebviewPanel | undefined = undefined;

let workspaceFolder = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : null;

export async function activate(context: vscode.ExtensionContext) {

	const globalStoragePath = context.globalStorageUri.fsPath;

    // Ensure the folder is created
    fs.promises.mkdir(globalStoragePath, { recursive: true })
        .then(() => {
            //console.log(`Folder created at ${globalStoragePath}`);
        })
        .catch((err) => {
            //console.error(`Failed to create folder: ${err}`);
        });

	const watcher = vscode.workspace.createFileSystemWatcher('**/*.py');

	const globalFolder = context.globalStorageUri.path;

    const provider = new DebugViewProvider(context.extensionUri, context.globalStorageUri);

	let fileChanged = false;
	let pythonExecuted = false;
	let restore = false;
	let gitChanged = false;

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(DebugViewProvider.viewType, provider));

	// detect changes to files
	watcher.onDidChange((uri) => {
		fileChanged = true;
		provider.receiveInformation("fileChanged", "");
	});

	// get terminal execution and check if python was run
	context.subscriptions.push(vscode.window.onDidStartTerminalShellExecution((event) => {
		if (event.execution.commandLine.value.includes('python')) {
			pythonExecuted = true;
			provider.receiveInformation("pythonRan", "");
		}
	}));

	/*
	vscode.workspace.onDidChangeWorkspaceFolders(() => {
		const newWorkspaceFolder = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : null;

		//if change is detected on workspace folders
		if (workspaceFolder !== newWorkspaceFolder) {
			workspaceFolder = newWorkspaceFolder;

			if (workspaceFolder) {
				//from null to real workspace
				provider.receiveInformation("workspaceInfo", newWorkspaceFolder);
			} else {
				//from real workspace  to null
				//not sure this is possible?
				provider.receiveInformation("workspaceInfo", "null");
			}
		}
	});
	*/

	// Check for file changes and Python execution
    setInterval(() => {
		//code was run before a file was ever changed
		if (pythonExecuted && !fileChanged) {
			pythonExecuted = false;
			provider.receiveInformation("resetNewNodeDebug", '');
		}
		//restoring the code triggers a fileChanged = true
		if (restore && fileChanged) {
			restore = false;
			fileChanged = false;
			provider.receiveInformation("resetNewNodeDebug", '');
		}
        if (fileChanged && pythonExecuted) {
            provider.receiveInformation("autoCreateNode", `File changed`);
            fileChanged = false;
            pythonExecuted = false;
        }
		if (gitChanged) {
			fileChanged = false;
			gitChanged = false;
			provider.receiveInformation("resetNewNodeDebug", '');
		}
    }, 1000); // Check every second

	/*
	// Detect Python execution
    function detectPythonExecution(terminal: vscode.Terminal) {
        if (terminal.name.includes("Python") || terminal.name.includes("Run Python")) {
            if (fileChanged) {
				console.log('create new node');
				provider.receiveInformation("autoCreateNode", 'Changes made to files');
				fileChanged = false;
			}
        }
    }
		*/


    // Register the 'showD3Graph' command
    context.subscriptions.push(
        vscode.commands.registerCommand('extension.showD3Graph', (treeData = {}, activeNode = {}) => {
            if (graphView) {
                graphView.reveal(vscode.ViewColumn.One);
                graphView.webview.postMessage({ command: 'updateGraph', treeData, activeNode });
                return;
            }

            graphView = vscode.window.createWebviewPanel(
                'd3Graph',
                'D3 Graph',
                vscode.ViewColumn.One,
                {
                    enableScripts: true,
					//retainContextWhenHidden supposedly can be resource hungry
					retainContextWhenHidden: true
                }
            );

            graphView.webview.html = getWebviewContent(graphView.webview, context.extensionUri, treeData, activeNode);

            graphView.webview.onDidReceiveMessage(
                message => {
                    switch (message.command) {
                        case 'updateActiveNode':
							const dir = globalFolder;
							const commitHash = message.commitId;
							const branchId = message.branchId;
							if (commitHash.length === 0) {
								//new child was added and restored to become selected
								//console.log("do nothing");
							} else {
								//restore the commit
								if (workspaceFolder !== null) {
									restoreToCommit({ fs, workspaceFolder, dir, commitHash, branchId});
								}
							}
                            provider.receiveInformation("activeNode", message.activeNode);
							restore = true;
                            break;
						//addNode might be deprecated
                        case 'addNode':
                            provider.receiveInformation("addNode", message.nodeId);
                            break;
						case 'updateXY':
							provider.receiveInformation("updateXY", {nodeId: message.nodeId, x: message.x, y: message.y});
							break;
                    }
                },
                undefined,
                context.subscriptions
            );

            graphView.onDidDispose(() => {
                graphView = undefined;
            });
        })
    );

    // Register the 'updateGraph' command
    context.subscriptions.push(
        vscode.commands.registerCommand('extension.updateGraph', (treeData = {}, activeNode = {}) => {
            if (graphView) {
                graphView.webview.postMessage({ command: 'updateGraph', treeData, activeNode });
            } else {
                //vscode.window.showErrorMessage('No graph panel is currently open.');
            }
        })
    );

	// Register the 'updateNodeText' command
    context.subscriptions.push(
        vscode.commands.registerCommand('extension.updateNodeText', (nodeId: number, newText: string) => {
            if (graphView) {
                graphView.webview.postMessage({ command: 'updateNodeText', nodeId, newText });
            } else {
                //vscode.window.showErrorMessage('No graph panel is currently open.');
            }
        })
    );

	// Register the 'attachCommit' command
	context.subscriptions.push(
        vscode.commands.registerCommand('extension.attachCommit', (nodeId: number, commitId: string, branchId: string) => {
			provider.receiveInformation("attachCommit", {nodeId: nodeId, commitId: commitId, branchId: branchId});
            if (graphView) {
                graphView.webview.postMessage({ command: 'attachCommit', nodeId, commitId, branchId });
            } else {
                //vscode.window.showErrorMessage('No graph panel is currently open.');
            }
        })
    );

	// Debug to figure out why git is broken
	context.subscriptions.push(
        vscode.commands.registerCommand('extension.resetCodeChange', () => {
			gitChanged = true;
        })
    );
}

/*

export function activate(context: vscode.ExtensionContext) {

    const provider = new DebugViewProvider(context.extensionUri);

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(DebugViewProvider.viewType, provider));

    //GRAPH
    context.subscriptions.push(
        vscode.commands.registerCommand('extension.showD3Graph', (treeData = {}, activeNode = {}) => {
            const panel = vscode.window.createWebviewPanel(
                'd3Graph',
                'D3 Graph',
                vscode.ViewColumn.One,
                {
                    enableScripts: true
                }
            );

            panel.webview.html = getWebviewContent(panel.webview, context.extensionUri, treeData, activeNode);

			panel.webview.onDidReceiveMessage(
				message => {		
					switch (message.command) {
						case 'updateActiveNode':
							provider.receiveInformation("activeNode", message.activeNode);
							//This closes the webview, but might not want it
							//panel.dispose();
							break;
						case 'addNode':
							provider.receiveInformation("addNode", message.nodeId);
							break;
					}
				},
				undefined,
				context.subscriptions
			);

        })
    );

	context.subscriptions.push(
        vscode.commands.registerCommand('extension.updateGraph', (treeData = {}, activeNode = {}) => {
            // This assumes `panel` is defined in some scope or use appropriate method to access the panel
            // Example of updating an existing webview panel or creating a new one
            const panel = vscode.window.activeWebviewPanel; // Adjust as necessary

            if (panel) {
                panel.webview.postMessage({ command: 'updateGraph', treeData: treeData, activeNode: activeNode });
            }
        })
    );

}

*/

function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri, treeData: any, activeNode: any) {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'graph.js'));

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>D3 Directed Graph</title>
        <style>
            body {
                margin: 0;
                padding: 0;
                overflow: hidden;
            }
            #graph {
                width: 100vw;
                height: 100vh;
                border: 1px solid black;
            }
			canvas {
				border: 1px solid black;
				display: block;
				margin: auto;
			}
        </style>
    </head>
    <body>
        <canvas id="canvas"></canvas>
        <script type="module">
			const treeData = ${JSON.stringify(treeData)};
			const activeNode = ${activeNode};
			
            import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7/+esm';

            // Load the external script and call createGraph function
            const script = document.createElement('script');
            script.type = 'module';
            script.src = '${scriptUri}';
            document.body.appendChild(script);

            script.onload = () => {
                import('${scriptUri}').then(module => {
                    module.createGraph(treeData, activeNode);
                });
            };
        </script>
    </body>
    </html>`;
}

//for removing the git
const { exec } = require('child_process');

class DebugViewProvider implements vscode.WebviewViewProvider {

	public static readonly viewType = 'debugPanel.panelView';

	private _view?: vscode.WebviewView;

	constructor(
		private readonly _extensionUri: vscode.Uri,
		private readonly _globalStorage: vscode.Uri
	) { }

	public async resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	) {
		this._view = webviewView;

		webviewView.webview.options = {
			// Allow scripts in the webview
			enableScripts: true,

			localResourceRoots: [
				this._extensionUri
			]
		};

		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

		webviewView.webview.onDidReceiveMessage(async data => {
			switch (data.type) {
                case 'showGraph':
                    {
						const treeData = data.treeData;
						const activeNode = data.activeNode;
                        vscode.commands.executeCommand('extension.showD3Graph', treeData, activeNode);
                        break;
                    }
				case 'updateGraph':
					{
						const treeData = data.treeData;
						const activeNode = data.activeNode;
						vscode.commands.executeCommand('extension.updateGraph', treeData, activeNode);
						break;
					}
				case 'updateNodeText':
					{
						const activeNode = data.activeNode;
						const newText = data.newText;
						vscode.commands.executeCommand('extension.updateNodeText', activeNode, newText);
						break;
					}
				case 'initializeRepo':
					{
						try {
							//git repo fileLoc
							const gitPath = this._globalStorage.path;
							let gitLoc: string;
							// Handle windows extra slash
							if (process.platform === 'win32' && gitPath.startsWith('/')) {
								gitLoc = gitPath.substring(1); // Remove the leading slash for Windows
							} else {
								gitLoc = gitPath;
							}

							//get all files and add them via git
							if (workspaceFolder !== null) {
								//create the git repo
								await git.init({ fs, dir: workspaceFolder, gitdir: gitLoc });

								const files = await listFiles(workspaceFolder);
								for (const file of files) {
									const relativeFilePath = path.relative(workspaceFolder, file);
									await git.add({
										fs,
										dir: workspaceFolder,
										gitdir: gitLoc,
										filepath: relativeFilePath
									}).catch(error => {
										console.error(`Error adding file: ${error.message}`);
									});
								}
							}

							//create the initial commit
							await git.commit({
								fs,
								gitdir: gitLoc,
								author: { name: 'Debug Extension', email: 'debug@extension.com' },
								message: 'Initial Repo Created'
							});

							const log = await git.log({ fs, gitdir: gitLoc });
							//0 for the root node, but could change eventually if we allow multiple roots (issues)
							vscode.commands.executeCommand('extension.attachCommit', 0, log[0].oid, "master");

						} catch (error) {
							console.error(error);
						}
						break;
					}
				case 'removeRepo':
					{
						let directoryPath = this._globalStorage.path;
						//exec(`rm -rf ${directoryPath}`);
						this.clearDirectory(directoryPath);
						break;
					}
				case 'createCommit':
					{
						//await saveAllFiles();
						const activeNode = data.activeNode;
						//git repo fileLoc
						//git repo fileLoc
						const gitPath = this._globalStorage.path;
						let gitLoc: string;
						// Handle windows extra slash
						if (process.platform === 'win32' && gitPath.startsWith('/')) {
							gitLoc = gitPath.substring(1); // Remove the leading slash for Windows
						} else {
							gitLoc = gitPath;
						}

						//branch information
						let branch = "";

						//if childCheck > 1, you need to make a new branch
						if (data.childCheck > 1) {
							/*
								I think this needs a random number or string attached to it.
								The format of parentBranch-branch(# of children) does not guarantee uniqueness.
							*/
							let uniqueId = await generateUniqueString(8);
							let newBranch = data.parentBranch + "-branch" + data.childCheck.toString() + "-" + uniqueId;
							await git.branch({ fs, gitdir: gitLoc, ref: newBranch });
							if (workspaceFolder !== null) {
								const files = await listFiles(workspaceFolder);
								const backup = await this.backupUncommittedChanges(files);
								await git.checkout({ fs, dir: workspaceFolder, gitdir: gitLoc, ref: newBranch, force: true });
								await this.restoreChanges(backup);
							}
							branch = newBranch;
						} else {
							branch = data.parentBranch;
						}
						
						let currentBranch = await git.currentBranch({ fs, gitdir: gitLoc });
						if (currentBranch !== branch && workspaceFolder !== null) {
							const files = await listFiles(workspaceFolder);
							const backup = await this.backupUncommittedChanges(files);
							await git.checkout({ fs, dir: workspaceFolder, gitdir: gitLoc, ref: branch, force: true });
							await this.restoreChanges(backup);
						}

						this.gitAddFiles(gitLoc);

						//create the commit
						const commitMessage = 'Updating node with ID ' + activeNode;
						await git.commit({
							fs,
							gitdir: gitLoc,
							author: { name: 'Debug Extension', email: 'debug@extension.com' },
							message: commitMessage
						});

						const log = await git.log({ fs, gitdir: gitLoc });
						//0 for the root node, but could change eventually if we allow multiple roots (issues)
						vscode.commands.executeCommand('extension.resetCodeChange');
						vscode.commands.executeCommand('extension.attachCommit', activeNode, log[0].oid, branch);
					}
			}
		});
	}

	private async gitAddFiles(gitLoc: string) {
		//get all files and add them via git
		if (workspaceFolder !== null) {
			const files = await listFiles(workspaceFolder);
			for (const file of files) {
				const relativeFilePath = path.relative(workspaceFolder, file);
				await git.add({
					fs,
					dir: workspaceFolder,
					gitdir: gitLoc,
					filepath: relativeFilePath
				});
			}
		}
	}

	private async backupUncommittedChanges(filepaths: string[]) {
		const backup: { [filepath: string]: string } = {};
		for (const filepath of filepaths) {
			const content = await fs.promises.readFile(`${filepath}`, 'utf8');
			backup[filepath] = content;
		}
		return backup;
	}

	private async restoreChanges(backup: { [filepath: string]: string }) {
		for (const filepath in backup) {
			await fs.promises.writeFile(`${filepath}`, backup[filepath], 'utf8');
		}
	}

	//Delete functionality to work cross platform
	private clearDirectory(dirPath: string) {
		// Check for paths on Windows and remove the leading slash if it is Windows
		if (process.platform === 'win32' && dirPath.startsWith('/')) {
			dirPath = dirPath.substring(1); // Remove the leading slash for Windows
		}
		fs.readdir(dirPath, (err, files) => {
			if (err) {
				console.error(`Error reading directory: ${err}`);
				return;
			}

			const deletePromises: Promise<void>[] = files.map(file => {
				const filePath = path.join(dirPath, file);
				return new Promise((resolve, reject) => {
					fs.stat(filePath, (err, stats) => {
						if (err) {
							return reject(err);
						}
						if (stats.isDirectory()) {
							fs.rm(filePath, { recursive: true }, (err) => {
								if (err) { return reject(err); }
								resolve();
							});
						} else {
							fs.unlink(filePath, (err) => {
								if (err) { return reject(err); }
								resolve();
							});
						}
					});
				});
			});

			Promise.all(deletePromises)
				.then(() => {
					console.log(`Directory contents removed successfully`);
				})
				.catch(error => {
					console.error(`Error deleting files: ${error}`);
				});
		});
	}

	public receiveInformation(command: any, data: any) {
		let info = {type: command, data: data};
		this._view?.webview.postMessage(info);
	}

	private _getHtmlForWebview(webview: vscode.Webview) {
		// Get the local path to main script run in the webview, then convert it to a uri we can use in the webview.
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js'));

        const styleResetUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'reset.css'));
		const styleVSCodeUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'vscode.css'));
		const styleMainUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.css'));

		// Use a nonce to only allow a specific script to be run.
		const nonce = getNonce();

		return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">

				<!--
					Use a content security policy to only allow loading styles from our extension directory,
					and only allow scripts that have a specific nonce.
					(See the 'webview-sample' extension sample for img-src content security policy examples)
				-->
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">

				<meta name="viewport" content="width=device-width, initial-scale=1.0">

                <link href="${styleResetUri}" rel="stylesheet">
				<link href="${styleVSCodeUri}" rel="stylesheet">
				<link href="${styleMainUri}" rel="stylesheet">

				<title>Debug</title>
			</head>
				<body>	
				<script nonce="${nonce}">
                	const workspaceData = "${workspaceFolder}";
				</script>
				<script nonce="${nonce}" src="${scriptUri}">
				</script>
				</body>
			</html>`;
	}
}

function getNonce() {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}

//helper function get all files for the initial commit
type FileList = string[];
async function listFiles(dirPath: string): Promise<FileList> {
	const files: FileList = [];
	
	async function readDir(currentPath: string): Promise<void> {
	  const entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
	  for (const entry of entries) {
		const fullPath = path.join(currentPath, entry.name);
		if (entry.isDirectory()) {
		  await readDir(fullPath);
		} else {
		  files.push(fullPath);
		}
	  }
	}
  
	await readDir(dirPath);
	return files;
  }

async function restoreToCommit({ fs, workspaceFolder, dir, commitHash, branchId }: {fs: any, workspaceFolder: string, dir: string, commitHash: string, branchId: string}) {
	// Check for paths on Windows and remove the leading slash if it is Windows
	if (process.platform === 'win32' && dir.startsWith('/')) {
		dir = dir.substring(1); // Remove the leading slash for Windows
	}
	console.log(dir);
	try {
		// Checkout the branch
		await git.checkout({
			fs,
			dir: workspaceFolder,
			gitdir: dir,
			ref: branchId,
			force: true
		});

		// Checkout the specific commit
		await git.checkout({
		  fs,
		  dir: workspaceFolder,
		  gitdir: dir,        // Directory where the .git folder is located (repository location)
		  ref: commitHash,
		  force: true, // Force checkout to override any working directory changes
		});

		//if (workspaceFolder !== null) {
			//const folderUri = vscode.Uri.file(workspaceFolder);
  
			// Iterate over the files in the directory and reopen them to ensure the editor reflects the changes
			//const files = await vscode.workspace.findFiles(new vscode.RelativePattern(folderUri, '**/*'));
			//for (const fileUri of files) {
				//const doc = await vscode.workspace.openTextDocument(fileUri); // Open the file document
				//await vscode.window.showTextDocument(doc, { preview: false }); // Re-show the document
			//}

			//console.log('Workspace files refreshed');
		//}
	  } catch (err) {
		console.error('Error during restore:', err);
	  }
}

//helper function to save all dirty files
async function saveAllFiles() {
	const openEditors = vscode.window.visibleTextEditors;
	const savePromises = openEditors.map(editor => {
		if (editor.document.isDirty) {
			return editor.document.save();
		}
		return Promise.resolve();
	});

	return Promise.all(savePromises);
}

//help function to create a unique character string
async function generateUniqueString(stringLength: number) {
	const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    const charactersLength = characters.length;

    for (let i = 0; i < stringLength; i++) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }

    return result;
}

export function deactivate() {}
