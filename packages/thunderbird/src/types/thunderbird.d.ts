declare namespace messenger {
  namespace messageDisplay {
    function getDisplayedMessage(
      tabId: number,
    ): Promise<messages.MessageHeader | null>;
  }

  namespace messages {
    interface MessageHeader {
      id: number;
      subject: string;
      author: string;
      date: Date;
      recipients: string[];
      headerMessageId: string; // Message-ID header value
    }

    interface MessagePart {
      contentType: string;
      body?: string;
      parts?: MessagePart[];
    }

    function getFull(messageId: number): Promise<MessagePart>;
  }

  namespace tabs {
    interface Tab {
      id?: number;
    }
    function query(queryInfo: {
      active?: boolean;
      currentWindow?: boolean;
    }): Promise<Tab[]>;
  }
}

declare namespace browser {
  namespace storage {
    namespace local {
      function get(key: string): Promise<Record<string, unknown>>;
      function set(items: Record<string, unknown>): Promise<void>;
      function remove(key: string): Promise<void>;
    }
  }
  namespace identity {
    function getRedirectURL(): string;
    function launchWebAuthFlow(details: {
      url: string;
      interactive: boolean;
    }): Promise<string>;
  }
  namespace runtime {
    function openOptionsPage(): Promise<void>;
  }
}
