import { createContext } from "svelte";
import type { ChatClient } from "./client.svelte";

/** The page creates one client; every chat component reads it from context. */
export const [useChat, provideChat] = createContext<ChatClient>();
