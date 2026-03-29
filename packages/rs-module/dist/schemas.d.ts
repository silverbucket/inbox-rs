export declare const bookmarkSchema: {
    type: string;
    properties: {
        isTodo: {
            type: string;
        };
        completed: {
            type: string;
        };
        completedAt: {
            type: string;
        };
        id: {
            type: string;
        };
        type: {
            type: string;
            enum: string[];
        };
        title: {
            type: string;
        };
        description: {
            type: string;
        };
        url: {
            type: string;
        };
        favicon: {
            type: string;
        };
        ogImage: {
            type: string;
        };
        siteName: {
            type: string;
        };
        body: {
            type: string;
        };
        filePath: {
            type: string;
        };
        mimeType: {
            type: string;
        };
        createdAt: {
            type: string;
        };
    };
    required: string[];
};
export declare const noteSchema: {
    type: string;
    properties: {
        isTodo: {
            type: string;
        };
        completed: {
            type: string;
        };
        completedAt: {
            type: string;
        };
        id: {
            type: string;
        };
        type: {
            type: string;
            enum: string[];
        };
        title: {
            type: string;
        };
        description: {
            type: string;
        };
        body: {
            type: string;
        };
        createdAt: {
            type: string;
        };
    };
    required: string[];
};
export declare const imageMetaSchema: {
    type: string;
    properties: {
        isTodo: {
            type: string;
        };
        completed: {
            type: string;
        };
        completedAt: {
            type: string;
        };
        id: {
            type: string;
        };
        type: {
            type: string;
            enum: string[];
        };
        title: {
            type: string;
        };
        description: {
            type: string;
        };
        filePath: {
            type: string;
        };
        mimeType: {
            type: string;
        };
        sourceUrl: {
            type: string;
        };
        createdAt: {
            type: string;
        };
    };
    required: string[];
};
export declare const audioMetaSchema: {
    type: string;
    properties: {
        isTodo: {
            type: string;
        };
        completed: {
            type: string;
        };
        completedAt: {
            type: string;
        };
        id: {
            type: string;
        };
        type: {
            type: string;
            enum: string[];
        };
        title: {
            type: string;
        };
        description: {
            type: string;
        };
        filePath: {
            type: string;
        };
        mimeType: {
            type: string;
        };
        duration: {
            type: string;
        };
        body: {
            type: string;
        };
        createdAt: {
            type: string;
        };
    };
    required: string[];
};
export declare const documentMetaSchema: {
    type: string;
    properties: {
        isTodo: {
            type: string;
        };
        completed: {
            type: string;
        };
        completedAt: {
            type: string;
        };
        id: {
            type: string;
        };
        type: {
            type: string;
            enum: string[];
        };
        title: {
            type: string;
        };
        description: {
            type: string;
        };
        filePath: {
            type: string;
        };
        mimeType: {
            type: string;
        };
        fileSize: {
            type: string;
        };
        fileName: {
            type: string;
        };
        createdAt: {
            type: string;
        };
    };
    required: string[];
};
export declare const codeSnippetSchema: {
    type: string;
    properties: {
        isTodo: {
            type: string;
        };
        completed: {
            type: string;
        };
        completedAt: {
            type: string;
        };
        id: {
            type: string;
        };
        type: {
            type: string;
            enum: string[];
        };
        title: {
            type: string;
        };
        description: {
            type: string;
        };
        body: {
            type: string;
        };
        language: {
            type: string;
        };
        createdAt: {
            type: string;
        };
    };
    required: string[];
};
export declare const emailSchema: {
    type: string;
    properties: {
        isTodo: {
            type: string;
        };
        completed: {
            type: string;
        };
        completedAt: {
            type: string;
        };
        id: {
            type: string;
        };
        type: {
            type: string;
            enum: string[];
        };
        title: {
            type: string;
        };
        description: {
            type: string;
        };
        body: {
            type: string;
        };
        from: {
            type: string;
        };
        notes: {
            type: string;
        };
        messageUrl: {
            type: string;
        };
        createdAt: {
            type: string;
        };
    };
    required: string[];
};
export declare const appConfigSchema: {
    type: string;
    properties: {
        todosCollapsed: {
            type: string;
        };
    };
};
export declare const todoSchema: {
    type: string;
    properties: {
        id: {
            type: string;
        };
        type: {
            type: string;
            enum: string[];
        };
        title: {
            type: string;
        };
        description: {
            type: string;
        };
        body: {
            type: string;
        };
        completed: {
            type: string;
        };
        completedAt: {
            type: string;
        };
        createdAt: {
            type: string;
        };
    };
    required: string[];
};
