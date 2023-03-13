/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as R from "ramda"
import * as RA from "ramda-adjunct"
import * as path from 'path';
import * as cp from 'child_process';
import { workspace, Uri, window, Disposable } from 'vscode';
import { QuickPickItem } from 'vscode';

const { changedFileNavigator } = workspace.getConfiguration('EpicUtils')

console.log("CHANGED", changedFileNavigator)
/**
 * A file opener using window.createQuickPick().
 * 
 * It shows how the list of items can be dynamically updated based on
 * the user's input in the filter field.
 */
export async function quickOpen() {
	const uri = await pickFile();
	if (uri) {
		const document = await workspace.openTextDocument(uri);
		await window.showTextDocument(document);
	}
}

class FileItem implements QuickPickItem {

	label: string;
	description: string;

	constructor(public base: Uri, public uri: Uri) {
		this.label = path.basename(uri.fsPath);
		this.description = path.dirname(path.relative(base.fsPath, uri.fsPath));
	}
}

class MessageItem implements QuickPickItem {

	label: string;
	description = '';
	detail: string;

	constructor(public base: Uri, public message: string) {
		this.label = message.replace(/\r?\n/g, ' ');
		this.detail = base.fsPath;
	}
}

const gitFilesChanged = ({ branch = "origin/develop", cwd }: Record<string, string>) => {
	try {
		const data = cp.execSync(`git diff --diff-filter=MARC --name-only \`git merge-base ${branch} HEAD\``, { cwd })
		return R.pipe(
			(x) => x.toString(),
			(x) => x.split('\n'),
			RA.compact,
			// R.tap(x => console.log(path.basename(x[0] as any))),
			R.sortBy(R.pipe(path.basename, R.length)),
			R.tap(x => console.log(x)) as any,
			R.map((relative: string) => new FileItem(Uri.file(cwd), Uri.file(path.join(cwd, relative)))),
		)(data)
	} catch (err) {
		console.error(err)
	}
}

async function pickFile() {
	const disposables: Disposable[] = [];
	try {
		return await new Promise<Uri | undefined>((resolve, reject) => {
			const input = window.createQuickPick<FileItem | MessageItem>();
			input.placeholder = 'EpicUtils: Search file by name';
			const cwds = workspace.workspaceFolders ? workspace.workspaceFolders.map(f => f.uri.fsPath) : [process.cwd()];
			let rgs: cp.ChildProcess[] = [];
			const output = gitFilesChanged({ cwd: cwds[0], branch: changedFileNavigator.parentBranch })
			input.items = output as any
			disposables.push(
				input.onDidChangeValue(value => {
					rgs.forEach(rg => rg.kill());
					if (!value || value.length <= 1) {
						input.items = [];
						return;
					}
					input.busy = true;
					const cwds = workspace.workspaceFolders ? workspace.workspaceFolders.map(f => f.uri.fsPath) : [process.cwd()];
					console.log(cwds)
					const q = process.platform === 'win32' ? '"' : '\'';
					rgs = cwds.map(cwd => {
						const rg = cp.exec(`rg --files -g ${q}*${value}*${q}`, { cwd }, (err, stdout) => {
							console.log(stdout)
							const i = rgs.indexOf(rg);
							if (i !== -1) {
								if (rgs.length === cwds.length) {
									input.items = [];
								}
								if (!err) {
									input.items = input.items.concat(
										stdout
											.split('\n').slice(0, 50)
											.map(relative => new FileItem(Uri.file(cwd), Uri.file(path.join(cwd, relative))))
									);
								}
								if (err && !(<any>err).killed && (<any>err).code !== 1 && err.message) {
									input.items = input.items.concat([
										new MessageItem(Uri.file(cwd), err.message)
									]);
								}
								rgs.splice(i, 1);
								if (!rgs.length) {
									input.busy = false;
								}
							}
						});
						return rg;
					});
				}),
				input.onDidChangeSelection(items => {
					const item = items[0];
					if (item instanceof FileItem) {
						resolve(item.uri);
						input.hide();
					}
				}),
				input.onDidHide(() => {
					rgs.forEach(rg => rg.kill());
					resolve(undefined);
					input.dispose();
				})
			);
			input.show();
		});
	} finally {
		disposables.forEach(d => d.dispose());
	}
}
