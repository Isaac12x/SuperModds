export type ModToolCategory = 'publishing' | 'workflow';

export type ModToolLaunchMode = 'menu' | 'form';

export type ModToolDescriptor = {
  id: string;
  title: string;
  description: string;
  category: ModToolCategory;
  launchMode: ModToolLaunchMode;
};

export type InitResponse = {
  type: 'init';
  username: string;
  subredditName: string | null;
};

export type ToolsResponse = {
  type: 'tools';
  tools: ModToolDescriptor[];
};
