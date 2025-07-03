import * as vscode from "vscode";

interface KeymapItem {
  lhs: string;
  rhs: string;
  mode: string;
  modeName: string;
  description?: string;
}

class NeovimKeymapsProvider {
  private keymaps: KeymapItem[] = [];
  private isVSCodeNeovimAvailable = false;
  private initialized: Promise<void>;
  private fuse: any = null;

  constructor() {
    this.initialized = this.loadKeymaps();
  }

  private async loadKeymaps(): Promise<void> {
    try {
      const neovimExt = vscode.extensions.getExtension("asvetliakov.vscode-neovim");
      if (!neovimExt) {
        throw new Error("vscode-neovim extension not found. Please install vscode-neovim extension.");
      }

      if (!neovimExt.isActive) {
        await neovimExt.activate();
      }

      this.isVSCodeNeovimAvailable = true;
      await this.fetchKeymapsFromVSCodeNeovim();
    } catch (error) {
      vscode.window.showErrorMessage(`vscode-neovim not accessible: ${error}`);
      this.isVSCodeNeovimAvailable = false;
    }
  }

  private async fetchKeymapsFromVSCodeNeovim(): Promise<void> {
    try {
      const luaScript = [
        "local result = {}",
        "local modes = {'n', 'i', 'v', 'x', 's', 'o', 't', 'c'}",
        "",
        "for _, mode in ipairs(modes) do",
        "  local ok, maps = pcall(vim.api.nvim_get_keymap, mode)",
        "  if ok and maps then",
        "    for _, map in ipairs(maps) do",
        "      table.insert(result, {",
        "        lhs = map.lhs or '',",
        "        rhs = map.rhs or '',",
        "        mode = mode,",
        "        desc = map.desc or '',",
        "        silent = map.silent == 1,",
        "        noremap = map.noremap == 1",
        "      })",
        "    end",
        "  end",
        "end",
        "",
        "-- Save raw data to clipboard",
        "local json_result = vim.fn.json_encode(result)",
        "vim.fn.setreg('+', 'ALL_KEYMAPS:' .. json_result)",
      ];

      const originalClipboard = await vscode.env.clipboard.readText();

      await vscode.commands.executeCommand("vscode-neovim.lua", luaScript);

      // Wait for clipboard operation
      await new Promise((resolve) => setTimeout(resolve, 100));

      const clipboardContent = await vscode.env.clipboard.readText();

      if (clipboardContent.startsWith("ALL_KEYMAPS:")) {
        const jsonData = clipboardContent.substring("ALL_KEYMAPS:".length);

        try {
          const rawKeymaps = JSON.parse(jsonData);
          this.keymaps = this.processRawKeymaps(rawKeymaps);
        } catch (jsonError) {
          console.error("Failed to parse JSON from clipboard:", jsonError);
          throw new Error("Invalid JSON data received from vscode-neovim");
        }
      } else {
        console.log("Expected keymap data not found in clipboard");
        throw new Error("Keymap data not found in clipboard");
      }

      // Restore original clipboard content
      await vscode.env.clipboard.writeText(originalClipboard);

      try {
        const { default: Fuse } = await import("fuse.js");
        this.fuse = new Fuse(this.keymaps, {
          keys: [
            { name: "lhs", weight: 0.4 },
            { name: "description", weight: 0.3 },
            { name: "rhs", weight: 0.2 },
            { name: "modeName", weight: 0.1 },
          ],
          threshold: 0.4,
          includeScore: true,
          ignoreLocation: true,
          findAllMatches: true,
          minMatchCharLength: 1,
        });
      } catch (error) {
        console.error("Failed to load Fuse.js:", error);
        this.fuse = null;
      }
    } catch (error) {
      console.error("Failed to fetch keymaps from vscode-neovim via clipboard:", error);
      vscode.window.showErrorMessage(`Failed to load keymaps: ${error}`);
    }
  }

  private processRawKeymaps(rawKeymaps: any[]): KeymapItem[] {
    const modeNames: { [key: string]: string } = {
      n: "Normal",
      i: "Insert",
      v: "Visual",
      x: "Visual Block",
      s: "Select",
      o: "Operator Pending",
      t: "Terminal",
      c: "Command",
    };

    const processed: KeymapItem[] = rawKeymaps
      .map((rawMap) => ({
        lhs: rawMap.lhs.startsWith(" ") ? "<leader>" + rawMap.lhs.substring(1) : rawMap.lhs || "",
        rhs: rawMap.rhs || "",
        mode: rawMap.mode,
        modeName: modeNames[rawMap.mode] || rawMap.mode,
        description: rawMap.desc || "",
      }))
      .filter(
        (rawMap) =>
          rawMap.lhs && rawMap.lhs.trim() !== "" && rawMap.description && rawMap.description.trim() !== "" && !rawMap.lhs.startsWith("<Plug>")
      );

    // Sort by mode, then by lhs
    processed.sort((a, b) => {
      if (a.mode !== b.mode) {
        return a.mode.localeCompare(b.mode);
      }
      return a.lhs.localeCompare(b.lhs);
    });

    return processed;
  }

  async getKeymaps(): Promise<KeymapItem[]> {
    await this.initialized;
    return this.keymaps;
  }

  async searchKeymaps(query: string): Promise<KeymapItem[]> {
    const keymaps = await this.getKeymaps();

    if (!query.trim()) {
      return keymaps;
    }

    if (!this.fuse) {
      const q = query.toLowerCase();
      return keymaps.filter(
        (k) =>
          k.lhs.toLowerCase().includes(q) ||
          k.rhs.toLowerCase().includes(q) ||
          k.modeName.toLowerCase().includes(q) ||
          k.description?.toLowerCase().includes(q)
      );
    }

    const results = this.fuse.search(query);
    return results.map((result: any) => result.item);
  }

  isVSCodeNeovimInstalled(): boolean {
    return this.isVSCodeNeovimAvailable;
  }
  async waitForInitialization(): Promise<void> {
    await this.initialized;
  }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const provider = new NeovimKeymapsProvider();
  await provider.waitForInitialization();

  const command = vscode.commands.registerCommand("neovim-keymaps-list.searchKeymaps", async () => {
    if (!provider.isVSCodeNeovimInstalled()) {
      vscode.window.showErrorMessage(
        "vscode-neovim extension not found. Please install vscode-neovim extension."
      );
      return;
    }

    const keymaps = await provider.getKeymaps();
    if (keymaps.length === 0) {
      vscode.window.showWarningMessage(
        "No custom keymaps found. Make sure vscode-neovim is active and configured."
      );
      return;
    }

    const quickPick = vscode.window.createQuickPick();
    quickPick.placeholder = `Search ${keymaps.length} keymaps...`;
    quickPick.matchOnDescription = true;
    quickPick.matchOnDetail = true;

    const mapToItem = (keymap: KeymapItem) => ({
      label: keymap.lhs,
      description: keymap.description,
      detail: `[${keymap.modeName}]${keymap.rhs ? ` - ${keymap.rhs}` : ""}`,
      keymap,
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
        vscode.window.showInformationMessage(
          `${k.modeName}: ${k.lhs}${k.rhs ? ` → ${k.rhs}` : ""}${k.description ? ` (${k.description})` : ""}`
        );
      }
      quickPick.dispose();
    });

    quickPick.show();
  });

  context.subscriptions.push(command);
}

export function deactivate(): void {}
