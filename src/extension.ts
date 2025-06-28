import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { promisify } from 'util';
import { attach } from '@chemzqm/neovim';

const execAsync = promisify(require('child_process').exec);

interface KeymapItem {
	lhs: string;
	rhs: string;
	mode: string;
	modeName: string;
	description?: string;
}

class NeovimKeymapsProvider {
	private keymaps: KeymapItem[] = [];
	private isNeovimAvailable = false;
	private initialized: Promise<void>;

	constructor() {
		this.initialized = this.loadKeymaps();
	}

	private async loadKeymaps(): Promise<void> {
		try {
			const nvimExe = await this.findNeovim();
			if (!nvimExe) throw new Error('Neovim not found');

			this.isNeovimAvailable = true;
			await this.fetchKeymaps(nvimExe);
		} catch (error)
		{
			vscode.window.showErrorMessage(`Neovim not accessible: ${error}`);
			this.isNeovimAvailable = false;
		}
	}

	private async findNeovim(): Promise<string | null> {
		try {
			await execAsync('nvim --version');
			return 'nvim';
		} catch {
			return null;
		}
	}

	private async fetchKeymaps(nvimExe: string): Promise<void> {
		let nvim: any = null;
		try {
			const process = spawn(nvimExe, ['--embed', '--headless']);
			nvim = attach({ proc: process });

			const modes = ["n", "i", "v", "x", "s", "o", "t", "c"];
			const modeNames: { [key: string]: string } = {
				n: "Normal", i: "Insert", v: "Visual", x: "Visual Block",
				s: "Select", o: "Operator Pending", t: "Terminal", c: "Command"
			};

			const allKeymaps: any[] = [];
			for (const mode of modes) {
				try {
					const maps = await nvim.call('nvim_get_keymap', [mode]);
					if (Array.isArray(maps)) {
						allKeymaps.push(...maps.map((map: any) => ({ ...map, mode })));
					}
				} catch {}
			}

			this.keymaps = allKeymaps
				.filter(map => map.desc && map.desc !== "Nvim builtin" && !map.lhs?.match(/^<Plug>/))
				.map(map => ({
					lhs: map.lhs?.startsWith(' ') ? '<leader>' + map.lhs.substring(1) : map.lhs || "",
					rhs: map.rhs || (map.callback ? "<callback>" : ""),
					mode: map.mode,
					modeName: modeNames[map.mode] || map.mode,
					description: map.desc
				}));

		} catch (error) {
			vscode.window.showErrorMessage(`Failed to load keymaps: ${error}`);
		} finally {
			try { await nvim?.quit(); } catch {}
		}
	}

	async getKeymaps(): Promise<KeymapItem[]> {
		await this.initialized;
		return this.keymaps;
	}

	async searchKeymaps(query: string): Promise<KeymapItem[]> {
		const keymaps = await this.getKeymaps();
		const q = query.toLowerCase();
		return keymaps.filter(k =>
			k.lhs.toLowerCase().includes(q) ||
			k.rhs.toLowerCase().includes(q) ||
			k.modeName.toLowerCase().includes(q) ||
			k.description?.toLowerCase().includes(q)
		);
	}

	isNeovimInstalled(): boolean { return this.isNeovimAvailable; }
	async waitForInitialization(): Promise<void> { await this.initialized; }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const provider = new NeovimKeymapsProvider();
	await provider.waitForInitialization();

	const command = vscode.commands.registerCommand('neovim-keymaps-list.searchKeymaps', async () => {
		if (!provider.isNeovimInstalled()) {
			vscode.window.showErrorMessage('Neovim not found. Please install Neovim.');
			return;
		}

		const keymaps = await provider.getKeymaps();
		if (keymaps.length === 0) {
			vscode.window.showWarningMessage('No custom keymaps found.');
			return;
		}

		const quickPick = vscode.window.createQuickPick();
		quickPick.placeholder = `Search ${keymaps.length} keymaps...`;
		quickPick.matchOnDescription = true;
		quickPick.matchOnDetail = true;

		const mapToItem = (keymap: KeymapItem) => ({
			label: keymap.lhs,
			description: keymap.description,
			detail: `[${keymap.modeName}]${keymap.rhs ? ` - ${keymap.rhs}` : ''}`,
			keymap
		});

		quickPick.items = keymaps.map(mapToItem);

		quickPick.onDidChangeValue(async (value) => {
			const filtered = await provider.searchKeymaps(value);
			quickPick.items = filtered.map(mapToItem);
		});

		quickPick.onDidAccept(() => {
			const selected = quickPick.selectedItems[0] as any;
			if (selected?.keymap) {
				const k = selected.keymap;
				vscode.window.showInformationMessage(`${k.modeName}: ${k.lhs}${k.rhs ? ` → ${k.rhs}` : ''}`);
			}
			quickPick.dispose();
		});

		quickPick.show();
	});

	context.subscriptions.push(command);
}

export function deactivate(): void {}
