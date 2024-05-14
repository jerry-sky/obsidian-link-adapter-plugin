import {OpenViewState, PaneType, Plugin, Workspace} from 'obsidian';
import GithubSlugger from 'github-slugger';
import * as path from 'path';


export default class ObsidianLinkAdapterPlugin extends Plugin {
	originalOpenLinkText: Workspace['openLinkText'];

	githubSlugger: GithubSlugger;

	onunload() {
		Workspace.prototype.openLinkText = this.originalOpenLinkText;
	}

	async onload() {
		this.githubSlugger = new GithubSlugger();

		this.originalOpenLinkText = Workspace.prototype.openLinkText;
		const originalOpenLinkText = Workspace.prototype.openLinkText;
		const that = this;
		Workspace.prototype.openLinkText = async function (linktext: string, sourcePath: string, newLeaf?: PaneType | boolean, openViewState?: OpenViewState) {
			const newLinkText = await that.parseGfmLinks.call(that, linktext, sourcePath);
			return originalOpenLinkText.call(this, newLinkText, sourcePath, newLeaf, openViewState);
		}


		this.registerEvent(
			this.app.workspace.on('editor-change', async (editor, change) => {
				const pos = editor.getCursor()
				const part = editor.getLine(pos.line).substring(0, pos.ch);

				// [whatever](file.md#some%20heading)
				const regex = /\[[^\]]*\]\(([^#]*)#([^)]+)\)$/g;
				const match = [...part.matchAll(regex)].at(-1);
				if (!match) {
					return;
				}

				const providedFilepath = match[1];
				const filepath = providedFilepath.length > 0 ? ObsidianLinkAdapterPlugin.resolvePath(this.app.workspace.activeEditor!.file!.parent!.path, providedFilepath) : this.app.workspace.activeEditor?.file?.path;
				if (typeof filepath !== 'string') {
					console.warn(`File path "${filepath}" not found`);
					return;
				}

				const obsidianGeneratedHeading = match[2];
				const humanReadableHeading = decodeURI(obsidianGeneratedHeading)
				const f = this.app.vault.getFileByPath(filepath);
				if (null === f) {
					console.warn('file not found at path:', filepath);
					return;
				}
				const data = await this.app.vault.read(f);
				for (const l of data.split('\n')) {
					if (l.search(/^#{1,6}\s+/) !== -1) {
						const heading = l.replace(/^#{1,6}\s+/, '');
						const slug = this.githubSlugger.slug(heading);
						if (humanReadableHeading === heading) {
							editor.replaceRange(slug, {
								line: pos.line,
								ch: match.index! + match[0].indexOf('#' + obsidianGeneratedHeading) + 1
							}, {line: pos.line, ch: pos.ch - 1});
							break;
						}
					}
					this.githubSlugger.reset();
				}
			})
		);
	}

	private static resolvePath(cwd: string, targetFilePath: string): string {
		const filename = path.parse(targetFilePath).base;
		targetFilePath = path.parse(targetFilePath).dir;
		while (path.parse(targetFilePath).dir.endsWith('..')) {
			cwd = path.parse(cwd).dir
			targetFilePath = path.parse(targetFilePath).dir
		}
		return path.join(path.parse(cwd).dir, filename);
	}

	private async parseGfmLinks(linktext: string, sourcePath: string) {
		let newLinkText = linktext;

		if (!this.app.workspace.activeEditor) {
			return linktext;
		}

		const t = linktext.split('#');
		const filepath = t[0].length > 0 ? ObsidianLinkAdapterPlugin.resolvePath(this.app.workspace.activeEditor!.file!.parent!.path, t[0]) : sourcePath;
		const headingPath = t[1];

		const f = this.app.vault.getFileByPath(filepath);
		if (null === f) {
			console.warn('parseGfmLinks: file not found at path:', sourcePath);
			return linktext;
		}
		const data = await this.app.vault.read(f);
		for (const l of data.split('\n')) {
			if (l.search(/^#{1,6}\s+/) !== -1) {
				const heading = l.replace(/^#{1,6}\s+/, '');
				const slug = this.githubSlugger.slug(heading);
				if (slug === headingPath) {
					newLinkText = heading;
					break;
				}
			}
			this.githubSlugger.reset();
		}
		return t[0] + '#' + newLinkText;
	}
}

