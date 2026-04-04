declare namespace browser {
  namespace runtime {
    function sendMessage(message: unknown): Promise<any>;
    const onMessage: {
      addListener(
        callback: (
          message: any,
          sender: any,
          sendResponse: (response?: any) => void,
        ) => boolean | void | Promise<unknown>,
      ): void;
    };
    function getURL(path: string): string;
  }
  namespace storage {
    const local: {
      get(keys: string | string[]): Promise<Record<string, any>>;
      set(items: Record<string, any>): Promise<void>;
    };
  }
  namespace tabs {
    function query(queryInfo: {
      active?: boolean;
      currentWindow?: boolean;
    }): Promise<Array<{ id?: number }>>;
    function sendMessage(tabId: number, message: unknown): Promise<any>;
  }
  namespace commands {
    const onCommand: {
      addListener(callback: (command: string) => void): void;
    };
  }
}
