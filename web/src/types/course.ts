export type ItemType = "video" | "text" | "quiz";

export type Item = {
  item_id: string;
  type: ItemType;
  order: number;
  payload_ref?: any;
};

export type Module = {
  id: string;
  title: string;
  order: number;
  unlocked: boolean;
  itemCount?: number;
  items: Item[];
  progress?: {
    status: string;
    score?: number;
    timeSpentSecs?: number;
  };
};
