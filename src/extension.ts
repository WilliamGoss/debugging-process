import * as vscode from 'vscode';
import * as git from "isomorphic-git";
import fs from 'fs';
import * as path from 'path';
import OpenAI from "openai";
import { diffLines } from 'diff';

import { CanvasViewProvider } from './panels/CanvasViewProvider';
//Python Interpreter for Output/Error
import { runPythonScript } from './runtime/pythonRunner';

let graphView: vscode.WebviewPanel | undefined = undefined;

let workspaceFolder = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : null;

/**
 * Maintain a mapping of the last run contents for each Python file.  This
 * allows the extension to determine whether the currently executed code
 * actually differs from the previous run.  The mapping is hydrated from
 * the globalState when the extension activates and persisted back to
 * globalState whenever it is updated.  By persisting into the
 * memento-backed storage we ensure that changes survive VS Code reloads
 * and can be compared across debugging sessions.
 */
type PreviousFileMap = { [filePath: string]: string };

// This will be initialised in activate() once the context is available.  It
// lives in the module scope so that it can be referenced inside the
// setInterval closure without repeatedly reading from globalState.  See
// activate() for where it is assigned and persisted.
let previousFileContents: PreviousFileMap;


export async function activate(context: vscode.ExtensionContext) {

	const globalStoragePath = context.globalStorageUri.fsPath;

	// Initialise the per-file history.  Use an empty object as the
	// default when nothing has been persisted yet.  Storing this in
	// globalState means it survives across extension reloads and VS Code
	// restarts.
	previousFileContents = (context.globalState.get<PreviousFileMap>('previousFileContents') as PreviousFileMap) || {};

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

    const provider = new DebugViewProvider(context, context.extensionUri, context.globalStorageUri);

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
		// Notify the webview that a file was modified so that the UI can
		// reflect the pending change.  The actual creation of a node
		// occurs when the user subsequently runs the Python file.
		provider.receiveInformation("fileChanged", "");
	});

	// get terminal execution and check if python was run
	context.subscriptions.push(vscode.window.onDidStartTerminalShellExecution((event) => {
		if (event.execution.commandLine.value.includes('python')) {
			pythonExecuted = true;
			// Inform the webview that a Python execution occurred.  This
			// information is used for visual debugging hints and does not
			// directly create nodes.
			provider.receiveInformation("pythonRan", "");
		}
	}));

	// Also listen for the start of a Python debug session.  Many users
	// execute their code via the debugger (for example by pressing F5) rather
	// than sending a command to the terminal.  The debug API exposes
	// onDidStartDebugSession which we can hook into to detect when a new
	// debug session begins.  We check the session's type to ensure that
	// we only respond to Python runs and set the pythonExecuted flag
	// accordingly.  This event complements the terminal watcher above and
	// should fire reliably across different platforms.
	context.subscriptions.push(vscode.debug.onDidStartDebugSession((session) => {
		try {
			// Some versions of VS Code may provide a providerId instead of type,
			// but the Python extension consistently sets type to 'python'.
			const sessionType = (session === null || session === void 0 ? void 0 : session.type) || (session === null || session === void 0 ? void 0 : session.configuration?.type);
			if (typeof sessionType === 'string' && sessionType.toLowerCase() === 'python') {
				pythonExecuted = true;
				provider.receiveInformation("pythonRan", "");
			}
		} catch (err) {
			console.error('Error processing debug session event:', err);
		}
	}));

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
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showErrorMessage("No active editor.");
                // Reset the flags because we cannot proceed
                fileChanged = false;
                pythonExecuted = false;
                return;
            }

            const filePath = editor.document.fileName;

            if (!filePath.endsWith('.py')) {
                vscode.window.showErrorMessage("Active file is not a Python file.");
                // Reset the flags because we cannot proceed
                fileChanged = false;
                pythonExecuted = false;
                return;
            }

            try {
                // Read the current contents of the Python file.  We do this
                // synchronously here because the interval callback should
                // complete quickly and the file sizes of interest are small.
                const currentContent = fs.readFileSync(filePath, 'utf8');
                const lastContent = previousFileContents[filePath] ?? '';

                // Use diffLines to detect if there are any added or removed
                // sections between the previous run and the current state.  If
                // diffLines returns a sequence where no part is marked as
                // added or removed then nothing substantive has changed.
                const diffs = diffLines(lastContent, currentContent);
                const hasChanges = diffs.some(part => (part as any).added || (part as any).removed);

                if (hasChanges || !(filePath in previousFileContents)) {
                    // The file content has changed since the last run (or this
                    // is the first time we are running this file).  Execute
                    // the Python script which will trigger a new node via
                    // provider.receiveInformation('autoCreateNode', …).
                    runPythonScript(filePath, provider);

                    // Persist the current state so that subsequent runs can
                    // determine whether another node should be created.  Store
                    // the content both in the in-memory cache and in the
                    // globalState so that it survives VS Code restarts.
                    previousFileContents[filePath] = currentContent;
                    context.globalState.update('previousFileContents', previousFileContents);
                } else {
                    // No meaningful changes were detected.  Notify the webview
                    // that the debug flags should be reset so that the UI
                    // reflects that a run occurred without creating a node.
                    provider.receiveInformation('resetNewNodeDebug', '');
                }
            } catch (err) {
                console.error('Error reading file for diff:', err);
            } finally {
                // Reset flags regardless of whether we created a node
                fileChanged = false;
                pythonExecuted = false;
            }
        }
		if (gitChanged) {
			fileChanged = false;
			gitChanged = false;
			//provider.receiveInformation("resetNewNodeDebug", '');
		}
    }, 1000); // Check every second


    // Register the 'showD3Graph' command
    context.subscriptions.push(
        vscode.commands.registerCommand('extension.showD3Graph', (treeData = {}, activeNode = {}) => {
            if (graphView) {
                graphView.reveal(vscode.ViewColumn.Two);
                graphView.webview.postMessage({ command: 'updateGraph', treeData, activeNode });
                return;
            }

            graphView = vscode.window.createWebviewPanel(
                'd3Graph',
                'Canvas',
                vscode.ViewColumn.Two,
                {
                    enableScripts: true,
					//retainContextWhenHidden supposedly can be resource hungry
					retainContextWhenHidden: true
                }
            );

            // Construct an HTML page that hosts the React-based canvas. This
            // replaces the old D3 visualization by loading the compiled
            // React bundle for the canvas. We generate a unique nonce for
            // script loading to satisfy the content security policy.
            {
                const scriptUri = graphView.webview.asWebviewUri(
					vscode.Uri.joinPath(context.extensionUri, 'dist', 'canvasApp.js')
				  );
				  const nonce = getNonce();
				  
				  graphView.webview.html = `<!DOCTYPE html>
				  <html lang="en">
				  <head>
					<meta charset="UTF-8" />
					<meta http-equiv="Content-Security-Policy"
						  content="default-src 'none';
								   img-src ${graphView.webview.cspSource} https:;
								   style-src ${graphView.webview.cspSource} 'unsafe-inline';
								   script-src 'nonce-${nonce}';">
					<meta name="viewport" content="width=device-width, initial-scale=1.0" />
					<title>Canvas</title>
				  </head>
				  <body>
					<div id="root"></div>
					<script nonce="${nonce}" src="${scriptUri}"></script>
				  </body>
				  </html>`;
                // After injecting the HTML, send the initial graph data to
                // the webview so that it can render the nodes. Without this
                // initial post the React app would start with an empty
                // canvas and wait for an updateGraph message. This mirrors
                // the behaviour of the old D3 graph which received the
                // initial tree via the HTML payload.
                graphView.webview.postMessage({ command: 'updateGraph', treeData, activeNode });
            }

            graphView.webview.onDidReceiveMessage(
                message => {
                    switch (message.command) {
                        case 'updateActiveNode':
							const dir = globalFolder;
							const commitHash = message.node.commitId;
							const branchId = message.node.branchId;
							if (commitHash.length === 0) {
								//new child was added and restored to become selected
								//console.log("do nothing");
							} else {
								//restore the commit
								if (workspaceFolder !== null) {
									restoreToCommit({ fs, workspaceFolder, dir, commitHash, branchId});
								}
							}
                            provider.receiveInformation("activeNode", message.node.id);
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
						case 'updateCardExpandState':
							provider.receiveInformation("updateExpandState", {nodeId: message.nodeId, expandState: message.expandState});
						case 'updateNodeText':
							provider.receiveInformation("updateNodeText", {nodeId: message.nodeId, nodeText: message.nodeText });
							break;
						case 'updateNodeBackground':
							provider.receiveInformation("updateNodeBackground", {nodeId: message.nodeId, bgColor: message.bgColor});
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

	// Register the 'updateSummary' command*
	context.subscriptions.push(
		vscode.commands.registerCommand('extension.updateSummary', (nodeId: number, changeLog: string) => {
			provider.receiveInformation("updateSummary", {nodeId: nodeId, changeLog: changeLog});
		})
	);

	// Debug to figure out why git is broken
	context.subscriptions.push(
        vscode.commands.registerCommand('extension.resetCodeChange', () => {
			gitChanged = true;
        })
    );

	context.subscriptions.push(
		vscode.commands.registerCommand(
		  'extension.exportData',
		  async (treeData: unknown = {}): Promise<boolean> => {
			try {
			  // Ensure a workspace is open
			  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
			  if (!workspaceFolder) {
				vscode.window.showErrorMessage('Open a folder/workspace before exporting.');
				return false;
			  }
	  
			  const gitSourceUri = getGitDirUri(context);
	  
			  const picked = await vscode.window.showOpenDialog({
				canSelectFiles: false,
				canSelectFolders: true,
				canSelectMany: false,
				openLabel: 'Select export destination'
			  });
			  if (!picked?.[0]) {
				return false; // user cancelled -> return a boolean, not undefined
			  }
	  
			  // 1) Try to name by first .py; 2) fallback to timestamp
			  let folderName = await pickExportFolderNameFromFirstPy(workspaceFolder);
			  if (!folderName) {
				folderName = `export-${new Date().toISOString().replace(/[:.]/g, '-')}`;
			  }
	  
			  // create a unique export directory under the chosen folder
			  const exportRoot = await ensureUniqueExportDir(picked[0], folderName);
			  const gitDestUri = vscode.Uri.joinPath(exportRoot, 'git');
			  const vizDestUri = vscode.Uri.joinPath(exportRoot, 'viz');
			  const dataFileUri = vscode.Uri.joinPath(vizDestUri, 'data.json');
	  
			  await vscode.window.withProgress(
				{ location: vscode.ProgressLocation.Notification, title: 'Exporting .git and viz data…' },
				async () => {
					await safeMkdir(exportRoot);
				  	await safeMkdir(vizDestUri);
	  
				  	if (await exists(gitSourceUri)) {
						await copyTree(gitSourceUri, gitDestUri);
				  	} else {
						vscode.window.showWarningMessage(
					  	'No Git repo found in globalStorage; skipping Git export.'
						);
				  	}
	  
				  	await writeJson(dataFileUri, treeData);

					// --- Copy the single .py into exportRoot (same level as git/ and viz/) ---
					const pySrc = await findSinglePyFile(workspaceFolder);
					if (pySrc) {
						const pyName = pySrc.path.split('/').pop()!; // uri.path always uses '/'
						const pyDest = vscode.Uri.joinPath(exportRoot, pyName);
						await vscode.workspace.fs.copy(pySrc, pyDest, { overwrite: true });
					} else {
						vscode.window.showWarningMessage('No Python file found to include in the export.');
					}
	  
				  // If you truly want to wipe storage after export, keep this line.
				  // Otherwise, comment it out so users can keep working:
				  // await clearDirectory(context.globalStorageUri);
				}
			  );
	  
			  vscode.window.showInformationMessage(`Export complete: ${exportRoot.fsPath}`);
			  return true; // <-- success
			} catch (err) {
			  console.error('exportData failed:', err);
			  vscode.window.showErrorMessage('Export failed. See logs for details.');
			  return false; // <-- failure
			}
		  }
		)
	  );

	  //Remove data
	  context.subscriptions.push(
		vscode.commands.registerCommand('extension.clearHiddenRepo', async (): Promise<boolean> => {
		  try {
			await clearDirectory(context.globalStorageUri);
			graphView?.dispose();
			graphView?.webview.postMessage({ command: 'updateGraph', treeData: [], activeNode: 0 });
			provider.receiveInformation('clearVizState', {});
			return true;
		  } catch (e) {
			console.error(e);
			return false;
		  }
		})
	  );

	  // helper: read JSON file via VS Code FS
async function readJson<T = any>(uri: vscode.Uri): Promise<T> {
	const bytes = await vscode.workspace.fs.readFile(uri);
	return JSON.parse(new TextDecoder().decode(bytes)) as T;
  }
  
  context.subscriptions.push(
	vscode.commands.registerCommand('extension.restoreData', async (): Promise<boolean> => {
		console.log("yoiooi");
	  try {
		// Let user pick the exported folder (that contains git/ and viz/data.json)
		const picked = await vscode.window.showOpenDialog({
		  canSelectFiles: false,
		  canSelectFolders: true,
		  canSelectMany: false,
		  openLabel: 'Select export folder (contains git/ and viz/)'
		});
		if (!picked?.[0]) return false;
  
		// Expect structure: <picked>/git , <picked>/viz/data.json
		let exportRoot = picked[0];
		let gitSrc = vscode.Uri.joinPath(exportRoot, 'git');
		let vizDir = vscode.Uri.joinPath(exportRoot, 'viz');
		let dataFile = vscode.Uri.joinPath(vizDir, 'data.json');
  
		// If user selected the parent, try to find a child that matches export-* shape (optional but handy)
		if (!(await exists(gitSrc)) || !(await exists(dataFile))) {
		  const entries = await vscode.workspace.fs.readDirectory(exportRoot);
		  const candidate = entries.find(([name, type]) => (type & vscode.FileType.Directory) && /^export-/.test(name));
		  if (candidate) {
			exportRoot = vscode.Uri.joinPath(exportRoot, candidate[0]);
			gitSrc = vscode.Uri.joinPath(exportRoot, 'git');
			vizDir = vscode.Uri.joinPath(exportRoot, 'viz');
			dataFile = vscode.Uri.joinPath(vizDir, 'data.json');
		  }
		}
  
		if (!(await exists(gitSrc))) {
		  vscode.window.showErrorMessage('Selected folder does not contain a git/ directory.');
		  return false;
		}
		if (!(await exists(dataFile))) {
		  vscode.window.showErrorMessage('Selected folder does not contain viz/data.json.');
		  return false;
		}
  
		// Copy git/ back to globalStorage and load viz state
		await vscode.window.withProgress(
		  { location: vscode.ProgressLocation.Notification, title: 'Restoring repository and visualization…' },
		  async () => {
			// 1) wipe current hidden repo, then copy restored one into globalStorage root
			await clearDirectory(context.globalStorageUri);
			await copyTree(gitSrc, context.globalStorageUri);
  
			// 2) read viz snapshot
			const snapshot = await readJson<{ root: number; nodeCount: number; activeNode: number; nodes: Record<string, any> }>(dataFile);
  
			// 3) tell the sidebar to adopt this state
			provider.receiveInformation('setVizState', snapshot);
  
			// 4) open/re-render the canvas with this data
			const nodeArray = Object.values(snapshot?.nodes ?? {});
			await vscode.commands.executeCommand('extension.showD3Graph', nodeArray, snapshot?.activeNode ?? 0);
		  }
		);
  
		vscode.window.showInformationMessage('Restore complete.');
		return true;
	  } catch (err) {
		console.error('restoreData failed:', err);
		vscode.window.showErrorMessage('Restore failed. See logs for details.');
		return false;
	  }
	})
  );

	//New View
	context.subscriptions.push(
		vscode.commands.registerCommand("extension.showCanvasView", () => {
			const panel = vscode.window.createWebviewPanel(
				"canvasMUIView",
				"Canvas MUI Panel",
				vscode.ViewColumn.One,
				{
					enableScripts: true,
					localResourceRoots: [context.extensionUri]
				}
			);

			const canvasProvider = new CanvasViewProvider(context.extensionUri);

			const scriptUri = vscode.Uri.joinPath(
				context.extensionUri,
				"dist",
				"canvasApp.js"
			  );
			  const webviewScriptUri = panel.webview.asWebviewUri(scriptUri);
			  const nonce = getNonce();
		  
			  panel.webview.html = (canvasProvider as any)._getHtml(webviewScriptUri, nonce);
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('extension.showViz', () => {
			provider.receiveInformation('openGraph', {});
		})
	);
}

//for removing the git
const { exec } = require('child_process');

class DebugViewProvider implements vscode.WebviewViewProvider {

	public static readonly viewType = 'debugPanel.panelView';

	private _view?: vscode.WebviewView;

	constructor(
		private readonly _ctx: vscode.ExtensionContext,
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
						if (workspaceFolder !== null) {
							const changeLog = await summarizeChanges(data.parentCommit, log[0].oid, workspaceFolder, gitLoc, this._ctx);
							vscode.commands.executeCommand('extension.updateSummary', activeNode, changeLog);
							vscode.commands.executeCommand('extension.updateNodeText', activeNode, changeLog[0]);
						}
						break;
					}
				case 'exportData':
					{
						const fullData = data.treeData;
						const ok = await vscode.commands.executeCommand<boolean>('extension.exportData', fullData);
						if (ok) {
							this.receiveInformation('goToClearView', {});
						}
						break;
					}
				case 'clearHiddenRepo':
					{
						vscode.commands.executeCommand<boolean>('extension.clearHiddenRepo');
						break;
					}
				case 'restoreData':
					{
						vscode.commands.executeCommand<boolean>('extension.restoreData');
						break;
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

		const logoUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'images', 'logo.png'));

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
				<meta http-equiv="Content-Security-Policy" content="
					default-src 'none';
					img-src ${webview.cspSource} data:;
					style-src ${webview.cspSource} 'unsafe-inline';
					script-src 'nonce-${nonce}';
				">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">

                <link href="${styleResetUri}" rel="stylesheet">
				<link href="${styleVSCodeUri}" rel="stylesheet">
				<link href="${styleMainUri}" rel="stylesheet">

				<title>Debug</title>
			</head>
				<body>
				<script nonce="${nonce}">
					window.__ASSETS__ = { logo: "${logoUri}" };
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

//Make this an API call on a server if there is time... 
async function summarizeChanges(parentCommit: string, newCommit: string, dir: string, gdir: string, ctx: vscode.ExtensionContext) {

	const files = fs.readdirSync(dir);
	const pyFiles = files.filter( f => f.endsWith('.py'));
	const absFilePath = path.join(dir, pyFiles[0]).substring(1);
	const filepath = pyFiles[0];

	const { blob: blob1 } = await git.readBlob({ 
		fs, 
		dir: dir, 
		gitdir: gdir, 
		oid: parentCommit, 
		filepath 
	});
	const text1 = new TextDecoder().decode(blob1);
	
	const { blob: blob2 } = await git.readBlob({ 
		fs, 
		dir, 
		gitdir: gdir,
		oid: newCommit,
		 filepath 
	});
	const text2 = new TextDecoder().decode(blob2);

	const diffs = diffLines(text1, text2);
	
	const diffString = JSON.stringify(diffs);

	// Point to your Flask endpoint
	const FLASK_URL =
	process.env.FLASK_URL ?? "https://debugging.web.illinois.edu/request_summary";

	const summary = await (async () => {
	const ac = new AbortController();
	const timer = setTimeout(() => ac.abort(), 10_000); // 10s timeout

	try {
	const res = await fetch(FLASK_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ diffString }),
		signal: ac.signal,
	});
	clearTimeout(timer);

	if (!res.ok) { throw new Error(`HTTP ${res.status}`); }

	const data = (await res.json()) as { summary?: string };
	const s = (data.summary ?? "").trim();
	return s || "No summary available.";
	} catch (err) {
	// Optionally log err to your extension output channel
	return "No summary available.";
	}
	})();

	return [summary, diffs];
}

/* ---------------------- Helpers (VS Code FS only) ---------------------- */

async function exists(uri: vscode.Uri): Promise<boolean> {
	try {
	  await vscode.workspace.fs.stat(uri);
	  return true;
	} catch {
	  return false;
	}
  }
  
  async function safeMkdir(uri: vscode.Uri): Promise<void> {
	try {
	  await vscode.workspace.fs.createDirectory(uri);
	} catch {
	  // Directory may already exist; ignore
	}
  }
  
  /**
   * Recursively copy a folder (or file) tree using VS Code FS APIs.
   * Handles File, Directory, and SymbolicLink entries.
   */
  async function copyTree(src: vscode.Uri, dst: vscode.Uri): Promise<void> {
	const stat = await vscode.workspace.fs.stat(src);
  
	// Directory
	if (stat.type & vscode.FileType.Directory) {
	  await safeMkdir(dst);
	  const entries = await vscode.workspace.fs.readDirectory(src);
	  for (const [name, type] of entries) {
		const from = vscode.Uri.joinPath(src, name);
		const to = vscode.Uri.joinPath(dst, name);
  
		if (type & vscode.FileType.Directory) {
		  await copyTree(from, to);
		} else if (type & vscode.FileType.File) {
		  await vscode.workspace.fs.copy(from, to, { overwrite: true });
		} else if (type & vscode.FileType.SymbolicLink) {
		  // Attempt a direct copy; if the backing FS supports it, this will work.
		  // Otherwise you could resolve the link target if your environment requires.
		  try {
			await vscode.workspace.fs.copy(from, to, { overwrite: true });
		  } catch {
			// Fall back to no-op if symlink copy isn’t supported in the current FS.
		  }
		}
	  }
	  return;
	}
  
	// File (or symlink treated as file)
	await vscode.workspace.fs.copy(src, dst, { overwrite: true });
  }
  
  /** Write a JSON object to a file via VS Code FS. */
  async function writeJson(uri: vscode.Uri, data: unknown): Promise<void> {
	const json = JSON.stringify(data, null, 2);
	// Uint8Array payload (Buffer works in Node, but Uint8Array is universal)
	await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(json));
  }
  
  /**
   * Clear a directory by deleting and re-creating it.
   * Safer and cross-platform vs hand-rolled rm/unlink logic.
   */
  async function clearDirectory(dirUri: vscode.Uri): Promise<void> {
	try {
	  await vscode.workspace.fs.delete(dirUri, { recursive: true, useTrash: false });
	} catch {
	  // ignore if not present
	}
	await vscode.workspace.fs.createDirectory(dirUri);
  }

  function getGitDirUri(ctx: vscode.ExtensionContext): vscode.Uri {
	return ctx.globalStorageUri;
  }

  // --- helpers ---
async function pickExportFolderNameFromFirstPy(workspaceFolder: vscode.Uri): Promise<string> {
	// look for the first .py file, skipping common noise
	const include = new vscode.RelativePattern(workspaceFolder, '**/*.py');
	const exclude = new vscode.RelativePattern(
	  workspaceFolder,
	  '{**/.venv/**,**/venv/**,**/env/**,**/__pycache__/**,**/site-packages/**,**/node_modules/**,**/.git/**}'
	);
	const [match] = await vscode.workspace.findFiles(include, exclude, 1);
	if (!match) return ''; // no .py found
	const stem = match.path.split('/').pop()!.replace(/\.py$/i, ''); // uri.path always uses '/'
	return sanitizeName(stem);
  }
  
  function sanitizeName(name: string): string {
	// replace spaces with '-', drop weird chars, cap length
	const cleaned = name.trim().replace(/\s+/g, '-').replace(/[^\w.-]/g, '_').slice(0, 64);
	return cleaned || 'export';
  }
  
  async function py_exists(uri: vscode.Uri): Promise<boolean> {
	try { await vscode.workspace.fs.stat(uri); return true; } catch { return false; }
  }
  
  // ensure we don't clobber an existing folder; returns the created dir
  async function ensureUniqueExportDir(parent: vscode.Uri, baseName: string): Promise<vscode.Uri> {
	let candidate = vscode.Uri.joinPath(parent, baseName);
	let i = 1;
	while (await py_exists(candidate)) {
	  candidate = vscode.Uri.joinPath(parent, `${baseName}-${i++}`);
	}
	await vscode.workspace.fs.createDirectory(candidate);
	return candidate;
  }

  // Find the single *.py file in the workspace (skips venvs, cache, etc.)
async function findSinglePyFile(workspaceFolder: vscode.Uri): Promise<vscode.Uri | undefined> {
	const include = new vscode.RelativePattern(workspaceFolder, '**/*.py');
	const exclude = new vscode.RelativePattern(
	  workspaceFolder,
	  '{**/.venv/**,**/venv/**,**/env/**,**/__pycache__/**,**/site-packages/**,**/node_modules/**,**/.git/**}'
	);
	const [match] = await vscode.workspace.findFiles(include, exclude, 1);
	return match;
  }

export function deactivate() {}
