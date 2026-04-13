export interface OllamaChatMessageModel {
  role: string;
  content: string;
}

export interface OllamaChatRequestModel {
  model: string;
  format: 'json';
  stream: false;
  messages: OllamaChatMessageModel[];
}

export interface OllamaChatResponseModel {
  message?: OllamaChatMessageModel;
  error?: string;
}
