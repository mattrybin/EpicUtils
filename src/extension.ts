import { commands, ExtensionContext } from 'vscode';
import { quickOpen } from './quickOpen';

export function activate(context: ExtensionContext) {
	context.subscriptions.push(commands.registerCommand('EpicUtils.changedFileNavigator', quickOpen));
}
