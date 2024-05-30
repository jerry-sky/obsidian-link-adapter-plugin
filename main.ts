import {
	CachedMetadata, HeadingCache, LinkCache,
	MetadataCache,
	OpenViewState,
	PaneType,
	Plugin,
	TAbstractFile,
	TFile,
	Vault,
	Workspace
} from 'obsidian';
import GithubSlugger from 'github-slugger';
import * as path from 'path';

interface CustomHeadingCache extends HeadingCache {
	artificial: boolean;
	originalHeading: string;
}

interface CustomLinkCache extends LinkCache {
	artificial: boolean;
}

export default class ObsidianLinkAdapterPlugin extends Plugin {
	originalOpenLinkText: Workspace['openLinkText'];
	originalRename: Vault['rename'];
	originalGetCache: MetadataCache['getCache'];
	originalGetFileCache: MetadataCache['getFileCache'];

	cache: any[] = [];
	cache2: any[] = [];

	githubSlugger: GithubSlugger;

	onunload() {
		Workspace.prototype.openLinkText = this.originalOpenLinkText;
		Vault.prototype.rename = this.originalRename;
		MetadataCache.prototype.getCache = this.originalGetCache;
		MetadataCache.prototype.getFileCache = this.originalGetFileCache;
	}

	async onload() {
		this.githubSlugger = new GithubSlugger();

		this.originalOpenLinkText = Workspace.prototype.openLinkText;
		const originalOpenLinkText = Workspace.prototype.openLinkText;
		const that = this;
		Workspace.prototype.openLinkText = async function (linktext: string, sourcePath: string, newLeaf?: PaneType | boolean, openViewState?: OpenViewState) {
			console.log('openLinkText', linktext, sourcePath, newLeaf, openViewState);
			const newLinkText = await that.parseGfmLinks.call(that, linktext, sourcePath);
			return originalOpenLinkText.call(this, linktext, sourcePath, newLeaf, openViewState);
		}

		this.originalRename = Vault.prototype.rename;
		const originalRename = Vault.prototype.rename;
		Vault.prototype.rename = async function (file: TAbstractFile, newPath: string) {
			console.log('rename', file, newPath);
			return originalRename.call(this, file, newPath);
		}

		this.originalGetCache = MetadataCache.prototype.getCache;
		const originalGetCache = MetadataCache.prototype.getCache;
		MetadataCache.prototype.getCache = function (path: string) {
			const out = originalGetCache.call(this, path);
			console.log('getCache', path, out);
			const newOut = that.convertMetadata.call(that, out, path);
			// console.log([...JSON.stringify(newOut).matchAll(/plumbing[-_\s]notes/ig)].map(x => x[0]));
			return newOut;
		}

		this.originalGetFileCache = MetadataCache.prototype.getFileCache;
		const originalGetFileCache = MetadataCache.prototype.getFileCache;
		MetadataCache.prototype.getFileCache = function (file: TFile) {
			const out = originalGetFileCache.call(this, file);
			console.log('getFileCache', file, out);
			const newOut = that.convertMetadata.call(that, out, file);
			// console.log([...JSON.stringify(newOut).matchAll(/plumbing[-_\s]notes/ig)].map(x => x[0]));
			return newOut;
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

	private convertMetadata(data: CachedMetadata, key: string | TFile): CachedMetadata {
		if (key instanceof TFile) {
			key = 'FILE::' + key.path
		}
		let map: Record<string, CustomHeadingCache> = this.cache[key];
		if (map === undefined) {
			map = {};
		}
		let map2: Record<string, CustomLinkCache> = this.cache[key];
		if (map2 === undefined) {
			map2 = {};
		}

		const sluggedMap: Record<string, HeadingCache> = [];
		const slugger = new GithubSlugger();
		for (const h of ((data.headings || []) as CustomHeadingCache[])) {

			if (h.artificial) {
				continue;
			}

			const headingKey = this.hashHeadingCache(h);
			if (map[headingKey]) {
				// map[headingKey];
				sluggedMap[map[headingKey].heading] = h;
				continue;
			}
			const slug = slugger.slug(h.heading);
			const newH: CustomHeadingCache = {
				heading: slug,
				position: {
					end: {...h.position.end},
					start: {...h.position.start},
				},
				level: h.level,
				artificial: true,
				originalHeading: h.heading,
			};
			map[headingKey] = newH;
			data.headings.push(newH);

			sluggedMap[map[headingKey].heading] = h;
		}
		console.log(map);
		this.cache[key] = map;

		for (const l of (data.links || []) as (CustomLinkCache)[]) {
			if (l.artificial) {
				continue;
			}

			const t = l.link.split('#');

			const linkKey = this.hashLinkCache(l);
			if (map2[linkKey]) {
				continue;
			}
			const h = sluggedMap[t[1]]
			console.log(l, h);
			if (!h) {
				continue;
			}
			console.log('MARKER', l.link, t[1], h.heading);
			const newL: CustomLinkCache = {
				link: l.link.replace(t[1], h.heading),
				position: {
					end: {...l.position.end},
					start: {...l.position.start},
				},
				artificial: true,
				original: l.original.replace(t[1], encodeURI(h.heading)),
				displayText: l.displayText,
			};
			data.links.push(newL);
			map2[linkKey] = newL;
		}

		return data;
	}

	private hashHeadingCache(heading: HeadingCache): string {
		return heading.heading + '::::' + heading.position.start.line + '::' + heading.position.start.col;
	}
	private hashLinkCache(link: LinkCache): string {
		return link.original + '::::' + link.position.start.line + '::' + link.position.start.col;
	}
}

