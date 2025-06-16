import { Db, Filter, FindOptions, ObjectId, Document, BulkWriteOptions, WriteConcern, OptionalId, CreateIndexesOptions, IndexDescription, Collection, ReadConcernLike, CollationOptions } from "mongodb"
import { z } from "zod"


interface BulkWriteError extends Error {
    name: string;
    writeErrors?: Array<unknown>;
    result?: {
        nInserted?: number;
        nFailedInserts?: number;
    };
}
const WRITE_OPERATIONS = ["update", "insert", "createIndex"];

type ObjectIdConversionMode = "auto" | "none" | "force";

function isObjectIdString(str: string): boolean {
    // MongoDB ObjectId is typically a 24-character hex string
    return /^[0-9a-fA-F]{24}$/.test(str);
}

// Helper function to check if a string is in ISO date format
function isISODateString(str: string): boolean {
    // Check if string matches ISO 8601 format
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(str);
}

function isObjectIdField(fieldName: string): boolean {
    // Convert field name to lowercase for case-insensitive comparison
    const lowerFieldName = fieldName.toLowerCase();

    // Consider fields like _id, id, xxxId, xxx_id as potential ObjectId fields
    return (
        lowerFieldName === "_id" ||
        lowerFieldName === "id" ||
        lowerFieldName.endsWith("id") ||
        lowerFieldName.endsWith("_id")
    );
}

function processObjectIdInFilter(
    filter: Record<string, unknown>,
    objectIdMode: ObjectIdConversionMode = "auto",
): Filter<Document> {
    // If objectIdMode is "none", don't convert any strings to ObjectIds
    if (objectIdMode === "none") {
        // Create a new filter object to handle dates
        const result: Record<string, unknown> = {};

        for (const [key, value] of Object.entries(filter)) {
            if (typeof value === "string" && isISODateString(value)) {
                // Convert ISO date string to Date object
                result[key] = new Date(value);
            } else if (typeof value === "string" && value.startsWith("ISODate(") && value.endsWith(")")) {
                // Handle ISODate("2025-01-01T00:00:00Z") format
                const dateString = value.substring(8, value.length - 2);
                if (isISODateString(dateString)) {
                    result[key] = new Date(dateString);
                } else {
                    result[key] = value;
                }
            } else if (typeof value === "object" && value !== null) {
                if (Array.isArray(value)) {
                    // For arrays, apply date conversion to each item
                    result[key] = value.map((item) => {
                        if (typeof item === "string" && isISODateString(item)) {
                            return new Date(item);
                        } else if (typeof item === "string" && item.startsWith("ISODate(") && item.endsWith(")")) {
                            const dateString = item.substring(8, item.length - 2);
                            return isISODateString(dateString) ? new Date(dateString) : item;
                        }
                        return item;
                    });
                } else {
                    // Process nested objects
                    result[key] = processObjectIdInFilter(
                        value as Record<string, unknown>,
                        "none"
                    );
                }
            } else {
                result[key] = value;
            }
        }
        return result as Filter<Document>;
    }

    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(filter)) {
        if (typeof value === "string" && isObjectIdString(value)) {
            // Convert string to ObjectId if either:
            // 1. objectIdMode is "force" (convert all 24-char hex strings)
            // 2. objectIdMode is "auto" AND the field name suggests it's an ObjectId
            if (
                objectIdMode === "force" ||
                (objectIdMode === "auto" && isObjectIdField(key))
            ) {
                result[key] = new ObjectId(value);
            } else {
                result[key] = value;
            }
        } else if (typeof value === "string" && isISODateString(value)) {
            // Convert ISO date string to Date object
            result[key] = new Date(value);
        } else if (typeof value === "string" && value.startsWith("ISODate(") && value.endsWith(")")) {
            // Handle ISODate("2025-01-01T00:00:00Z") format
            const dateString = value.substring(8, value.length - 2);
            if (isISODateString(dateString)) {
                result[key] = new Date(dateString);
            } else {
                result[key] = value;
            }
        } else if (typeof value === "object" && value !== null) {
            if (Array.isArray(value)) {
                // For arrays, apply the same logic to each item
                result[key] = value.map((item) => {
                    if (typeof item === "string" && isObjectIdString(item) &&
                        (objectIdMode === "force" || (objectIdMode === "auto" && isObjectIdField(key)))) {
                        return new ObjectId(item);
                    } else if (typeof item === "string" && isISODateString(item)) {
                        return new Date(item);
                    } else if (typeof item === "string" && item.startsWith("ISODate(") && item.endsWith(")")) {
                        const dateString = item.substring(8, item.length - 2);
                        return isISODateString(dateString) ? new Date(dateString) : item;
                    }
                    return item;
                });
            } else {
                // Process nested objects
                result[key] = processObjectIdInFilter(
                    value as Record<string, unknown>,
                    objectIdMode,
                );
            }
        } else {
            result[key] = value;
        }
    }

    return result;
}
function parseFilter(
    filter: unknown,
    objectIdMode: ObjectIdConversionMode = "auto",
): Filter<Document> {
    if (!filter) {
        return {};
    }

    if (typeof filter === "string") {
        try {
            return processObjectIdInFilter(JSON.parse(filter), objectIdMode);
        } catch (e) {
            throw new Error("Invalid filter format: must be a valid JSON object");
        }
    }

    if (typeof filter === "object" && filter !== null && !Array.isArray(filter)) {
        // Process the filter to convert potential ObjectId strings
        return processObjectIdInFilter(
            filter as Record<string, unknown>,
            objectIdMode,
        );
    }

    throw new Error("Query filter must be a plain object or ObjectId");
}

function formatResponse(data: unknown) {
    return {
        content: [
            {
                type: "text" as const,
                text: JSON.stringify(data, null, 2),
            },
        ],
    };
}

function handleError(
    error: unknown,
    operation: string,
    collectionName?: string,
) {
    const context = collectionName ? `collection ${collectionName}` : "operation";

    let errorMsg = ""
    if (error instanceof Error) {
        errorMsg = `Failed to ${operation} ${context}: ${error.message}`
    }
    errorMsg = `Failed to ${operation} ${context}: Unknown error`
    console.error(errorMsg);
    return {
        content: [
            {
                type: "text" as const,
                text: errorMsg
            },
        ],
        isError: true,
    };
}


const queryToolSchema = z.object({
    collectionName: z.string().describe("The name of the MongoDB collection to query."),
    filter: z.record(z.unknown()).optional().describe("MongoDB filter object"),
    projection: z.record(z.unknown()).optional().describe("Fields to include or exclude"),
    limit: z.number().int().positive().optional().describe("Limit number of results."),
    explain: z.union([z.literal("queryPlanner"), z.literal("executionStats"), z.literal("allPlansExecution")]).optional().describe("Get MongoDB explain plan"),
    sort: z.record(z.unknown()).optional().describe("MongoDB sort object")
})
type QueryToolInputType = z.infer<typeof queryToolSchema>
const queryCollectionTool = async (args: QueryToolInputType, db: Db) => {
    const { collectionName, filter, projection, limit, explain, sort } = args

    const collection = db.collection(collectionName)
    const queryFilter = parseFilter(filter ?? {}, "auto")

    try {
        if (explain) {
            const explainResult = await collection.find(queryFilter, { projection, limit: limit || 100, sort } as FindOptions<Document>).explain(explain)
            return formatResponse(explainResult)
        }
        const cursor = collection.find(queryFilter, {
            projection,
            limit: limit || 10,
            sort
        } as FindOptions<Document>)

        const results = await cursor.toArray();

        return formatResponse(results)
    } catch (error) {
        return handleError(error, "query", collectionName)
    }

}

export { QueryToolInputType, queryToolSchema, queryCollectionTool }

const aggregateToolSchema = z.object({
    collectionName: z.string().describe("Name of the MongoDB collection"),
    pipeline: z.array(z.record(z.string(), z.unknown())).describe("MongoDB aggregation pipeline"),
    explain: z.enum(["queryPlanner", "executionStats", "allPlansExecution"]).optional()
})
type AggregateToolSchemaType = z.infer<typeof aggregateToolSchema>
const aggregateCollectionTool = async (args: AggregateToolSchemaType, db: Db) => {
    const { collectionName, pipeline, explain } = args
    const collection = db.collection(collectionName)
    if (!collection) {
        return {
            content: [{ type: "text" as const, text: "Collection not found !!!" }],
            isError: true
        }
    }
    if (!Array.isArray(pipeline)) {
        return {
            content: [{ type: "text" as const, text: "Pipeline must be an array." }],
            isError: true
        }
    }

    const processedPipeline = pipeline.map((stage) => {
        if (typeof stage === "object" && stage !== null) {
            return processObjectIdInFilter(stage, "auto")
        }
        return stage
    })

    try {
        if (explain) {
            const cursor = collection.aggregate(processedPipeline)
            const explainResult = await cursor.explain(explain)

            return formatResponse(explainResult)
        }
        const results = await collection.aggregate(processedPipeline).toArray()
        return formatResponse(results)
    } catch (error) {
        return handleError(error, "aggregate", collectionName)
    }
}

export { AggregateToolSchemaType, aggregateToolSchema, aggregateCollectionTool }

const updateToolSchema = z.object({
    collectionName: z.string().describe("Name of the MongoDB collection"),
    filter: z.record(z.string(), z.unknown()).optional(),
    update: z.record(z.string(), z.unknown()),
    upsert: z.boolean().optional().default(false),
    multi: z.boolean().optional().default(false)
})
type UpdateToolSchemaType = z.infer<typeof updateToolSchema>
const updateCollectionTool = async (args: UpdateToolSchemaType, db: Db) => {
    const { collectionName, multi, update, upsert, filter } = args

    const collection = db.collection(collectionName)

    if (!collection) {
        return {
            content: [{ type: "text" as const, text: `Collection ${collectionName} not found.` }],
            isError: true
        }
    }

    const queryFilter = parseFilter(filter, "auto")

    let processedUpdate = update;
    if (update && typeof update === "object" && !Array.isArray(update)) {
        processedUpdate = processObjectIdInFilter(update, "auto")
    }

    if (!processedUpdate || typeof processedUpdate !== "object" || Array.isArray(processedUpdate)) {
        return {
            content: [{ type: "text" as const, text: "Update must be a valid MongoDB update object." }],
            isError: true
        }
    }

    const validUpdateOperators = [
        "$set", "$unset", "$inc", "$push", "$pull",
        "$addToSet", "$pop", "$rename", "$mul"
    ];

    const hasValidOperator = Object.keys(processedUpdate).some((key) => validUpdateOperators.includes(key))

    if (!hasValidOperator) {
        return {
            content: [
                {
                    type: 'text' as const,
                    text: `Update must contain at least one valid MongoDB update operator. Valid operators: ${validUpdateOperators.join(", ")}`
                }
            ],
            isError: true
        }
    }
    try {
        const updateMethod = multi ? "updateMany" : "updateOne";
        const result = await collection[updateMethod](queryFilter, processedUpdate, {
            upsert: !!upsert,
        });

        return formatResponse({
            matchedCount: result.matchedCount,
            modifiedCount: result.modifiedCount,
            upsertedCount: result.upsertedCount,
            upsertedId: result.upsertedId,
        });

    } catch (error) {
        return handleError(error, "update", collectionName)
    }
}

export { UpdateToolSchemaType, updateToolSchema, updateCollectionTool }

const ServerInfoInputToolSchema = z.object({
    includeDebugInfo: z.boolean().optional()
})
type ServerInfoInputToolSchemaType = z.infer<typeof ServerInfoInputToolSchema>
const serverInfoInputTool = async (args: ServerInfoInputToolSchemaType, db: Db) => {
    const { includeDebugInfo = false } = args

    try {
        const buildInfo = await db.command({ buildInfo: 1 })

        let serverStatus = null;
        if (includeDebugInfo) {
            serverStatus = await db.command({ serverStatus: 1 })
        }

        const serverInfo: any = {
            version: buildInfo.version,
            gitVersion: buildInfo.gitVersion,
            modules: buildInfo.modules,
            allocator: buildInfo.allocator,
            javascriptEngine: buildInfo.javascriptEngine,
            sysInfo: buildInfo.sysInfo,
            storageEngines: buildInfo.storageEngines,
            debug: buildInfo.debug,
            maxBsonObjectSize: buildInfo.maxBsonObjectSize,
            openssl: buildInfo.openssl,
            buildEnvironment: buildInfo.buildEnvironment,
            bits: buildInfo.bits,
            ok: buildInfo.ok,
            connectionInfo: {
                readOnlyMode: false, // Replace with real read-only detection if needed
                readPreference: "primary",
            },
        }
        if (serverStatus) {
            serverInfo.status = {
                host: serverStatus.host,
                version: serverStatus.version,
                process: serverStatus.process,
                pid: serverStatus.pid,
                uptime: serverStatus.uptime,
                uptimeMillis: serverStatus.uptimeMillis,
                uptimeEstimate: serverStatus.uptimeEstimate,
                localTime: serverStatus.localTime,
                connections: serverStatus.connections,
                network: serverStatus.network,
                memory: serverStatus.mem,
                storageEngine: serverStatus.storageEngine,
                security: serverStatus.security,
            };
        }

        return formatResponse(serverInfo)
    } catch (error) {
        return handleError(error, "serverInfo", "")
    }
}

export { ServerInfoInputToolSchemaType, ServerInfoInputToolSchema, serverInfoInputTool }

const InsertInputToolSchema = z.object({
    collectionName: z.string().describe("Name of the MongoDB collection"),
    documents: z.array(z.record(z.unknown())),
    ordered: z.boolean().optional(),
    writeConcern: z.any().optional(),
    bypassDocumentValidation: z.boolean().optional(),
    objectIdMode: z.enum(["auto", "force", "none"]).optional().default("auto")
})
type InsertInputToolSchemaType = z.infer<typeof InsertInputToolSchema>
const insertInputTool = async (args: InsertInputToolSchemaType, db: Db) => {
    const { collectionName, documents, bypassDocumentValidation, ordered, writeConcern, objectIdMode } = args

    if (!Array.isArray(documents) || documents.length === 0) {
        return {
            content: [{ type: "text" as const, text: "documents must be a non-empty array" }],
            isError: true
        }
    }
    const collection = db.collection(collectionName)

    if (!collection) {
        return {
            content: [{ type: "text" as const, text: `Collection ${collectionName} not found.` }],
            isError: true
        }
    }

    const processedDocuments = documents.map(doc => {
        if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
            return {
                content: [{ type: "text" as const, text: `Each document must be a valid object` }],
                isError: true
            }
        }
        return processObjectIdInFilter(doc as Record<string, unknown>, objectIdMode) as OptionalId<Document>;
    })

    try {
        const options: BulkWriteOptions = {
            ordered: ordered !== false,
            writeConcern: writeConcern as WriteConcern,
            bypassDocumentValidation: bypassDocumentValidation
        }

        const result = await collection.insertMany(processedDocuments, options);

        return formatResponse({
            acknowledged: result.acknowledged,
            insertedCount: result.insertedCount,
            insertedIds: result.insertedIds,
        });
    } catch (error) {
        if (error instanceof Error && error.name === "BulkWriteError") {
            const bulkError = error as BulkWriteError;

            return formatResponse({
                error: "Bulk write error occurred",
                writeErrors: bulkError.writeErrors,
                insertedCount: bulkError.result?.nInserted || 0,
                failedCount: bulkError.result?.nFailedInserts || 0,
            });
        }

        return handleError(error, "insert", collection.collectionName);
    }
}

export { InsertInputToolSchemaType, InsertInputToolSchema, insertInputTool }

const CreateIndexesInputToolSchema = z.object({
    collectionName: z.string().describe("Name of the MongoDB collection"),
    indexes: z.array(z.record(z.unknown())),
    commitQuorum: z.union([z.string(), z.number()]).optional(),
    objectIdMode: z.enum(["auto", "force", "none"]).optional().default("auto")
})
type CreateIndexesInputToolSchemaType = z.infer<typeof CreateIndexesInputToolSchema>
const createIndexesInputTool = async (args: CreateIndexesInputToolSchemaType, db: Db) => {
    const { collectionName, objectIdMode, indexes, commitQuorum } = args

    if (!Array.isArray(indexes) || indexes.length === 0) {
        return {
            content: [{ type: "text" as const, text: "indexes must be a non-empty array" }],
            isError: true
        }
    }
    const collection = db.collection(collectionName)

    if (!collection) {
        return {
            content: [{ type: "text" as const, text: `Collection ${collectionName} not found.` }],
            isError: true
        }
    }

    const processedIndexes: IndexDescription[] = indexes.map((index) => {
        if (
            index &&
            typeof index === "object" &&
            !Array.isArray(index) &&
            "key" in index
        ) {
            return {
                ...(index as unknown as IndexDescription),
                key: processObjectIdInFilter(
                    (index as unknown as IndexDescription).key as Record<string, unknown>,
                    objectIdMode
                ),
            };
        }
        throw new Error("Each index must be an object with a 'key' field");
    });

    try {
        const options: CreateIndexesOptions = {
            commitQuorum: typeof commitQuorum === "number" || typeof commitQuorum === "string"
                ? commitQuorum
                : undefined
        };

        const result = await collection.createIndexes(
            processedIndexes,
            options
        );

        return formatResponse({
            result
        });
    } catch (error) {
        if (error instanceof Error && error.name === "BulkWriteError") {
            const bulkError = error as BulkWriteError;

            return formatResponse({
                error: "Bulk write error occurred",
                writeErrors: bulkError.writeErrors,
                insertedCount: bulkError.result?.nInserted || 0,
                failedCount: bulkError.result?.nFailedInserts || 0,
            });
        }

        return handleError(error, "create-indexes", collection.collectionName);
    }
}

export { CreateIndexesInputToolSchemaType, CreateIndexesInputToolSchema, createIndexesInputTool }

const CountToolSchema = z.object({
    collectionName: z.string().describe("Name of the MongoDB collection"),
    filter:z.record(z.unknown()).optional().describe("MongoDB filter object"),
    limit: z.number().int().positive().optional().describe("Limit the number of documents to count"),
    skip: z.number().int().nonnegative().optional().describe("Skip a number of documents"),
    hint: z.record(z.unknown()).optional().describe("Index hint for the query"),
    readConcern:z.record(z.unknown()).optional().describe("Max time in milliseconds the operation is allowed to run"),
    maxTimeMS: z.number().int().positive().optional().describe("Max time in milliseconds the operation is allowed to run"),
    collation:z.record(z.unknown()).optional().describe("Collation settings for string comparison"),
    objectIdMode: z.enum(["auto", "force", "none"]).optional().default("auto")
})
type CountToolInputType = z.infer<typeof CountToolSchema>;
const countDocumentsTool = async (
  args: CountToolInputType,
  db: Db
) => {
  const {
    collectionName,
    filter,
    limit,
    skip,
    hint,
    readConcern,
    maxTimeMS,
    collation,objectIdMode
  } = args;

  const collection: Collection<Document> = db.collection(collectionName);
  const countQuery = parseFilter(filter ?? {}, objectIdMode);
function isCollationOptions(value: unknown): value is CollationOptions {
  return typeof value === "object" && value !== null && "locale" in value;
}
  try {
    const options = {
      limit,
      skip,
      hint: typeof hint === "object" && hint !== null ? hint : undefined,
      readConcern: typeof readConcern === "object" && readConcern !== null ? readConcern as ReadConcernLike : undefined,
      maxTimeMS,
      collation: isCollationOptions(collation) ? collation : undefined
    };

    const count = await collection.countDocuments(countQuery, options);

    return formatResponse({
      count,
      ok: 1
    });
  } catch (error) {
    return handleError(error, "count", collectionName);
  }
};

export { CountToolSchema, CountToolInputType, countDocumentsTool };
