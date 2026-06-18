import MarkdownIt from "markdown-it";

const md = new MarkdownIt({ html: false, linkify: true, typographer: false });

const tests = [
  `![alt](./diagrams/system-block-diagram.svg)`,
  `![alt](./diagrams/system%20block%20diagram.svg)`,
  `![alt](https://example.com/image.png)`,
  `![alt](./test.png)`,
];

for (const t of tests) {
  const tokens = md.parse(t, {});
  const inline = tokens.find((tok) => tok.type === "inline");
  console.log("Input:", t);
  console.log("Children:", inline?.children?.map((c: any) => ({ type: c.type, content: c.content, src: c.attrGet?.("src") })));
  console.log("---");
}
