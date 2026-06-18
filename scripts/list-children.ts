import { Client, isFullBlock } from '@notionhq/client';
import dotenv from 'dotenv';
dotenv.config();

const token = process.env.NOTION_TOKEN;
const pageId = process.env.NOTION_PAGE_ID;

if (!token || !pageId) {
  console.error('Missing NOTION_TOKEN or NOTION_PAGE_ID');
  process.exit(1);
}

const client = new Client({ auth: token });

async function listChildren(blockId: string, depth = 0) {
  const results = [];
  let cursor: string | undefined;
  do {
    const res = await client.blocks.children.list({ block_id: blockId, start_cursor: cursor, page_size: 100 });
    results.push(...res.results);
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);

  for (const b of results) {
    if (!isFullBlock(b)) continue;
    const indent = '  '.repeat(depth);
    if (b.type === 'child_page') {
      console.log(indent + 'CHILD_PAGE:', b.id, b.child_page.title);
    } else if (b.type === 'link_to_page') {
      console.log(indent + 'LINK_TO_PAGE:', JSON.stringify(b.link_to_page));
    } else {
      console.log(indent + b.type, b.id, b.has_children ? '(has_children)' : '');
      if (b.has_children) {
        await listChildren(b.id, depth + 1);
      }
    }
  }
}

listChildren(pageId).catch((err) => {
  console.error(err);
  process.exit(1);
});
