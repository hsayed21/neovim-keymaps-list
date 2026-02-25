import * as vscode from "vscode";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";

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
  private keymapsFetched = false;

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
      const tempFilePath = path.join(os.tmpdir(), `nvim_keymaps_${Date.now()}.json`);

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
        "-- Save raw data to temp file",
        "local json_result = vim.fn.json_encode(result)",
        "local file = io.open('" + tempFilePath.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "', 'w')",
        "if file then",
        "  file:write(json_result)",
        "  file:close()",
        "end",
      ];

      await vscode.commands.executeCommand("vscode-neovim.lua", luaScript);

      // Wait for file write
      await new Promise((resolve) => setTimeout(resolve, 100));

      if (fs.existsSync(tempFilePath)) {
        const fileContent = fs.readFileSync(tempFilePath, 'utf-8');
        
        const rawKeymaps = JSON.parse(fileContent);
        this.keymaps = this.processRawKeymaps(rawKeymaps);
        this.keymapsFetched = true;

        fs.unlinkSync(tempFilePath);
      } else {
        throw new Error("Keymap data file not found");
      }

      // Initialize Fuse.js for fuzzy search
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
      console.error("Failed to fetch keymaps from vscode-neovim:", error);
      this.keymapsFetched = false;
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

  async ensureKeymapsLoaded(): Promise<boolean> {
    await this.initialized;

    if (!this.isVSCodeNeovimAvailable) {
      return false;
    }

    if (!this.keymapsFetched || this.keymaps.length === 0) {
      try {
        // Wait a bit for Neovim to be fully loaded
        await new Promise(resolve => setTimeout(resolve, 500));

        await this.fetchKeymapsFromVSCodeNeovim();

        return this.keymapsFetched && this.keymaps.length > 0;
      } catch (error) {
        console.error("Retry failed:", error);
        return false;
      }
    }

    return true;
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

  async refreshKeymaps(): Promise<boolean> {
    if (!this.isVSCodeNeovimAvailable) {
      return false;
    }

    try {
      this.keymapsFetched = false;
      this.keymaps = [];
      this.fuse = null;

      await this.fetchKeymapsFromVSCodeNeovim();
      return this.keymapsFetched && this.keymaps.length > 0;
    } catch (error) {
      console.error("Refresh failed:", error);
      return false;
    }
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

    const keymapsLoaded = await provider.ensureKeymapsLoaded();
    if (!keymapsLoaded) {
      vscode.window.showErrorMessage(
        "Failed to load keymaps from Neovim. Please ensure vscode-neovim is fully loaded and configured."
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

  const refreshCommand = vscode.commands.registerCommand("neovim-keymaps-list.refreshKeymaps", async () => {
    if (!provider.isVSCodeNeovimInstalled()) {
      vscode.window.showErrorMessage(
        "vscode-neovim extension not found. Please install vscode-neovim extension."
      );
      return;
    }

    try {
      const success = await provider.refreshKeymaps();
      if (success) {
        const keymaps = await provider.getKeymaps();
        vscode.window.showInformationMessage(
          `Successfully refreshed ${keymaps.length} keymaps from Neovim.`
        );
      } else {
        vscode.window.showErrorMessage(
          "Failed to refresh keymaps. Please ensure vscode-neovim is fully loaded and configured."
        );
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to refresh keymaps: ${error}`);
    }
  });

  context.subscriptions.push(command, refreshCommand);
}

export function deactivate(): void {}
