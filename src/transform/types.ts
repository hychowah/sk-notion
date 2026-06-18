export type RichTextSegment = {
  text: string;
  link?: { url: string };
};

export type ContentNode =
  | { type: "heading_1" | "heading_2" | "heading_3" | "heading_4"; segments: RichTextSegment[] }
  | { type: "paragraph"; segments: RichTextSegment[] }
  | { type: "bulleted_list_item" | "numbered_list_item"; segments: RichTextSegment[] }
  | { type: "quote"; segments: RichTextSegment[] }
  | { type: "code"; text: string; language: string }
  | { type: "divider" }
  | { type: "image"; source: string; caption?: string };

export type MarkdownTransformResult = {
  nodes: ContentNode[];
  warnings: string[];
};

export type BlockBuildResult = {
  warnings: string[];
  uploadedImages: Array<{
    source: string;
    fileUploadId: string;
  }>;
};