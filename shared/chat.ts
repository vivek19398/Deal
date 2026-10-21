/** Room chat is a separate stream: sending a message never advances the game version. */
export interface ChatMessage {
  id: string;
  clientId: string;
  senderId: string;
  senderName: string;
  text: string;
  createdAt: number;
}
export interface ChatInput {
  clientId: string;
  text: string;
}
export interface ChatReply {
  error?: string;
  message?: ChatMessage;
}
export const CHAT_LIMIT = 280;
export const CHAT_HISTORY = 100;
