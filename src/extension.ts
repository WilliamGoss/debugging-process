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

    //context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(DebugViewProvider.viewType, provider);
	//);

	// detect changes to files
	watcher.onDidChange((uri) => {
		fileChanged = true;
		//provider.receiveInformation("fileChanged", "");
	});

	// get terminal execution and check if python was run
	context.subscriptions.push(vscode.window.onDidStartTerminalShellExecution((event) => {
		console.log(event);
		if (event.execution.commandLine.value.includes('python')) {
			pythonExecuted = true;
			//provider.receiveInformation("pythonRan", "");
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
			//provider.receiveInformation("resetNewNodeDebug", '');
		}
		//restoring the code triggers a fileChanged = true
		if (restore && fileChanged) {
			restore = false;
			fileChanged = false;
			//provider.receiveInformation("resetNewNodeDebug", '');
		}
        if (fileChanged && pythonExecuted) {
            provider.receiveInformation("autoCreateNode", `File changed`);
            fileChanged = false;
            pythonExecuted = false;
        }
		if (gitChanged) {
			fileChanged = false;
			gitChanged = false;
			//provider.receiveInformation("resetNewNodeDebug", '');
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
                'Canvas',
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
						case 'hideNode':
							provider.receiveInformation("hideNode", message.nodeId);
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

	// This command should be used to export the users github and graph with nodes to allow rebuilding.
	context.subscriptions.push(
		vscode.commands.registerCommand('extension.exportData', (treeData = {}) => {
			if (workspaceFolder !== null) {
				if (graphView) {
					graphView.dispose();
				}
				// Create a git folder inside the workspace
				const gitCopyPath = path.join(workspaceFolder, 'git');
				createFolder(gitCopyPath);
				// Copy all the contents from the git repo into the new folder
				copyFiles(globalStoragePath, gitCopyPath);
				// Create a folder for the node data to recreate the viz
				const vizCopyPath = path.join(workspaceFolder, 'viz');
				saveJsonFile(vizCopyPath, treeData);
				clearDirectory(globalStoragePath);
			}
		})
	);

	// Helper command for the above command, since we need to call main.js to send the data out
	context.subscriptions.push(
		vscode.commands.registerCommand('extension.export', () => {
			provider.receiveInformation("triggerExport", {});
        })
	);
}

function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri, treeData: any, activeNode: any) {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'graph.js'));
	const imageUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'images', 'cursor.png'));

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Canvas</title>
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
				display: block;
				margin: auto;
			}
			.node-text {
				overflow: scroll;
				user-select: none; /* Disable node text selection */
				color: black;
			}
			/* Hide the scrollbar but keep the scrolling functionality */
			.node-text::-webkit-scrollbar {
				display: none; /* Hides the scrollbar */
			}
			.node-text {
				-ms-overflow-style: none;  /* For Internet Explorer and Edge */
				scrollbar-width: none;     /* For Firefox */
			}
			/* Floating buttons container style */
			.floating-buttons {
				position: fixed; /* Fixed to the screen */
				bottom: 20px;    /* Distance from the bottom */
				right: 20px;     /* Distance from the right */
				display: flex;
				gap: 10px;       /* Space between buttons */
				user-select: none; /* Stop highlighting when dragging nodes or selection the canvas */
			}
			/* Button style */
			.floating-button {
				width: 50px;
				height: 50px;
				background-color: #4CAF50;
				color: white;
				font-size: 20px;
				border-radius: 50%;
				text-align: center;
				line-height: 50px;
				cursor: pointer;
				box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
				transition: background-color 0.3s ease;
				display: none;
			}
			.floating-button:hover {
				background-color: #45a049;
			}
			/* Active button state */
			.active {
				background-color: #FF5733;
			}
			.cursor {
				position: absolute;
				top: 4px;
				left: 6px;
			}
			/* Styling for the custom context menu */
			#contextMenu {
				display: none;
				position: absolute;
				background-color: white;
				border: 1px solid #ccc;
				box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
				z-index: 1000;
			}

			#contextMenu ul {
				list-style-type: none;
				margin: 0;
				padding: 5px;
			}

			#contextMenu ul li {
				padding: 8px;
				cursor: pointer;
				color: #333;
			}

			#contextMenu ul li:hover {
				background-color: #f0f0f0;
			}
        </style>
    </head>
    <body>
        <canvas id="canvas"></canvas>
		<div class="floating-buttons">
			<!-- Cursor Button with Image -->
			<div class="floating-button" id="cursorButton">
				<img class="cursor" src="${imageUri}" alt="Cursor" width="42" height="42" />
			</div>
			<!-- Pen button -->
			<div class="floating-button" id="penButton">✏️</div>
		</div>
		<!-- Custom context menu -->
		<div id="contextMenu">
			<ul>
				<li id="deleteOption">Delete</li>
			</ul>
		</div>
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
				case 'getExport':
					{
						const treeData = data.treeData;
						vscode.commands.executeCommand('extension.exportData', treeData);
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
						clearDirectory(directoryPath);
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

// Create a folder
async function createFolder(folderPath: string) {
	const folderUri = vscode.Uri.file(folderPath);
	try {
		await vscode.workspace.fs.createDirectory(folderUri);
	} catch (error) {
		console.log(error);
	}
}

// Copy files
async function copyFiles(sourceFolderPath: string, destFolderPath: string) {
    const sourceUri = vscode.Uri.file(sourceFolderPath);
    const destUri = vscode.Uri.file(destFolderPath);

    try {
        // Read the contents of the source directory
        const files = await vscode.workspace.fs.readDirectory(sourceUri);

        // Loop over each file and copy it to the destination
        for (const [fileName, fileType] of files) {
            const sourceFilePath = path.join(sourceFolderPath, fileName);
            const destFilePath = path.join(destFolderPath, fileName);

            const sourceFileUri = vscode.Uri.file(sourceFilePath);
            const destFileUri = vscode.Uri.file(destFilePath);

            if (fileType === vscode.FileType.Directory) {
                // If it's a directory, call copyFiles recursively
                await createFolder(destFilePath); // Ensure the folder exists in the destination
                await copyFiles(sourceFilePath, destFilePath); // Recursively copy the subfolder
            } else {
                // If it's a file, copy it
                await vscode.workspace.fs.copy(sourceFileUri, destFileUri, { overwrite: true });
            }
        }

    } catch (error) {
        console.error(error);
    }
}

// Save JSON file
async function saveJsonFile(folderLocation: string, data: {}) {
	await createFolder(folderLocation);

	const dataFilePath = path.join(folderLocation, 'data.json');
	const nodeJson = JSON.stringify(data, null, 2);

	fs.writeFile(dataFilePath, nodeJson, 'utf8', (err) => {
		if (err) {
			console.log(err);
		}
	});
}

//Delete functionality to work cross platform
function clearDirectory(dirPath: string) {
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

export function deactivate() {}
