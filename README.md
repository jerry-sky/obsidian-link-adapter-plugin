# Obsidian Link Adapter

Plugin that converts Obsidian-generated links into GFM (GitHub’s Markdown) format when a link is inserted.

It also translates GFM links to Obsidian ones on the fly so Obsidian can understand them.

## Example

```md
## Another Section

## Section

[link](#another-section)

[obsidian link](#Another%20Section)
```

If user clicks the `link`, Obsidian by default would not go to _Another Section_ and would not highlight it.
This plugin translates heading slugs into links Obsidian can understand, like the one below (`obsidian link`).

---

## API Documentation

See https://github.com/obsidianmd/obsidian-api
