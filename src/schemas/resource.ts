import { ReadResourceRequest } from "@modelcontextprotocol/sdk/types.js";
import { CollectionInfo, Db, ObjectId,Document } from "mongodb"

const handleListResourcesRequest = async (db: Db) => {
    try {
        const collections = await db.listCollections().toArray();
        const collectionNames = collections.map((c) => c.name);

        return {
            contents: [
                {
                    uri: "resource:mongo-collections:text",
                    text: `Available MongoDB collections:\n\n${collectionNames.join("\n")}`,
                },
            ],
        };
    } catch (error: any) {
        return {
            contents: [
                {
                    uri: "resource:mongo-collections:error",
                    text: `Error fetching collections: ${error?.message || "Unknown error"}`,
                },
            ],
            isError: true,
        };
    }
};
export { handleListResourcesRequest }

const handleListResourcesRequestTool = async (db: Db) => {
    try {
        const collections = await db.listCollections().toArray();
        const collectionNames = collections.map((c) => c.name);

        return {
            content: [
                {
                    type: "text" as const,
                    text: `Available MongoDB collections:\n\n${collectionNames.join("\n")}`,
                },
            ],
        };
    } catch (error: any) {
        return {
            content: [
                {
                    type: "text" as const,
                    text: `Error fetching collections: ${error?.message || "Unknown error"}`,
                },
            ],
            isError: true,
        };
    }
};
export { handleListResourcesRequestTool }

const handleReadResourcesRequest = async (uri:any, collectionName:any,db:Db) => {
    try {
        // const url = new URL(request.params.uri)
        // const collectionName = url.pathname.replace(/^\//, "")

        const collection = db.collection(collectionName)
        const sampleSize = 100;
        let sampleDocuments = [];

        try {
            sampleDocuments = await collection.aggregate([{ $sample: { size: sampleSize } }]).toArray()
        } catch (sampleError) {
            console.warn(`$sample failed, falling back: ${sampleError}`)
            sampleDocuments = await collection.find({}).limit(sampleSize).toArray()
        }

        const indexes = await collection.indexes()
        const inferredSchema = inferSchemaFromSamples(sampleDocuments);

        let documentCount: number | string | null = null;

        try {
            documentCount = await Promise.race([
                collection.countDocuments(),
                new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
            ])
        } catch {
            try {
                const stats = await db.command({ collStats: collectionName })
                documentCount = stats.count
            } catch {
                documentCount = "unknown (timeout)"
            }
        }

        const schema = {
            type: "collection",
            name: collectionName,
            fields: inferredSchema.fields,
            indexes: indexes.map(idx => ({
                name: idx.name,
                keys: idx.key,
            })),
            documentCount,
            sampleSize: sampleDocuments.length,
            lastUpdated: new Date().toISOString(),
        }

        return {
            contents:[
                {
                    uri:uri,
                    text:JSON.stringify(schema,null,2),
                    type:"application/json"
                }
            ]
        }

    } catch (error: any) {
        console.error(`Error reading resource: ${error.message}`);
        return {
            contents: [
                {
                    uri: uri,
                    text: `Failed to read resource: ${error?.message || "Unknown error"}`,
                    type:"text/plain"
                },
            ],
            isError: true,
        };
    }
};
export { handleReadResourcesRequest }
const handleReadResourcesRequestTool = async (collectionName:string,db:Db) => {
    try {
        // const url = new URL(request.params.uri)
        // const collectionName = url.pathname.replace(/^\//, "")

        const collection = db.collection(collectionName)
        const sampleSize = 100;
        let sampleDocuments = [];

        try {
            sampleDocuments = await collection.aggregate([{ $sample: { size: sampleSize } }]).toArray()
        } catch (sampleError) {
            console.warn(`$sample failed, falling back: ${sampleError}`)
            sampleDocuments = await collection.find({}).limit(sampleSize).toArray()
        }

        const indexes = await collection.indexes()
        const inferredSchema = inferSchemaFromSamples(sampleDocuments);

        let documentCount: number | string | null = null;

        try {
            documentCount = await Promise.race([
                collection.countDocuments(),
                new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
            ])
        } catch {
            try {
                const stats = await db.command({ collStats: collectionName })
                documentCount = stats.count
            } catch {
                documentCount = "unknown (timeout)"
            }
        }

        const schema = {
            type: "collection",
            name: collectionName,
            fields: inferredSchema.fields,
            indexes: indexes.map(idx => ({
                name: idx.name,
                keys: idx.key,
            })),
            documentCount,
            sampleSize: sampleDocuments.length,
            lastUpdated: new Date().toISOString(),
        }

        return {
            content:[
                {
                    type:"text" as const,
                    text:JSON.stringify(schema,null,2)
                }
            ]
        }

    } catch (error: any) {
        console.error(`Error reading resource: ${error.message}`);
        return {
            content: [
                {
                    type:"text" as const,
                    text: `Failed to read resource: ${error?.message || "Unknown error"}`
                },
            ],
            isError: true,
        };
    }
};
export { handleReadResourcesRequestTool }


function detectMongoType(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  
  if (value instanceof ObjectId) return 'ObjectId';
  if (value instanceof Date) return 'Date';
  if (Array.isArray(value)) {
    if (value.length === 0) return 'Array';
    
    // Check if array has consistent types
    const elementTypes = new Set(value.map(item => detectMongoType(item)));
    if (elementTypes.size === 1) {
      return `Array<${Array.from(elementTypes)[0]}>`;
    }
    return 'Array<mixed>';
  }
  
  if (typeof value === 'object') {
    // Handle nested documents
    return 'Document';
  }
  
  return typeof value;
}

interface FieldInfo {
  name: string;
  types: Set<string>;
  nullable: boolean;
  samples: unknown[];
  nestedSchema?: SchemaResult;
}

interface SchemaResult {
  fields: FieldSummary[];
}

interface FieldSummary {
  name: string;
  types: string[];
  nullable: boolean;
  prevalence: string;
  examples: unknown[];
  nestedSchema?: SchemaResult;
}

function inferSchemaFromSamples(documents: Document[]):SchemaResult {
  if (!documents || documents.length === 0) {
    return { fields: [] };
  }

  // Use a Map to store field information, with the key being the field name
  const fieldMap = new Map<string, FieldInfo>();
  
  // Process each document to collect field information
  for (const doc of documents) {
    for (const [key, value] of Object.entries(doc)) {
      if (!fieldMap.has(key)) {
        // Initialize field info if we haven't seen this field before
        fieldMap.set(key, {
          name: key,
          types: new Set([detectMongoType(value)]),
          nullable: false,
          // Store sample values for complex types
          samples: [value],
        });
      } else {
        // Update existing field info
        const fieldInfo = fieldMap.get(key)!;
        fieldInfo.types.add(detectMongoType(value));
        
        // Store up to 3 different sample values
        if (fieldInfo.samples.length < 3 && 
            !fieldInfo.samples.some((sample: unknown) => 
              JSON.stringify(sample) === JSON.stringify(value))) {
          fieldInfo.samples.push(value);
        }
      }
    }
  }
  
  // Check for nullable fields by seeing which fields are missing in some documents
  for (const doc of documents) {
    for (const [key] of fieldMap.entries()) {
      if (!(key in doc)) {
        const fieldInfo = fieldMap.get(key)!;
        fieldInfo.nullable = true;
      }
    }
  }
  
  // Process nested document schemas
  for (const [key, fieldInfo] of fieldMap.entries()) {
    if (fieldInfo.types.has('Document')) {
      // Extract nested documents for this field
      const nestedDocs = documents
        .filter((doc:Document) => doc[key] && typeof doc[key] === 'object' && !Array.isArray(doc[key]))
        .map(doc => doc[key] as Document);
      
      if (nestedDocs.length > 0) {
        // Recursively infer schema for nested documents
        fieldInfo.nestedSchema = inferSchemaFromSamples(nestedDocs);
      }
    }
  }
  
  // Convert the Map to an array of field objects with additional info
  const fields = Array.from(fieldMap.values()).map(fieldInfo => {
    const result: FieldSummary = {
      name: fieldInfo.name,
      types: Array.from(fieldInfo.types),
      nullable: fieldInfo.nullable,
      prevalence: Math.round((documents.filter(doc => fieldInfo.name in doc).length / documents.length) * 100) + '%',
      examples: [],
    };
    
    // Include nested schema if available
    if (fieldInfo.nestedSchema) {
      result.nestedSchema = fieldInfo.nestedSchema;
    }
    
    // Include simplified sample values
    const sampleValues = fieldInfo.samples.map((sample: unknown) => {
      if (sample instanceof ObjectId) return sample.toString();
      if (sample instanceof Date) return sample.toISOString();
      if (typeof sample === 'object') {
        // For objects/arrays, just indicate type rather than full structure
        return Array.isArray(sample) ? '[...]' : '{...}';
      }
      return sample;
    });
    
    result.examples = sampleValues;
    
    return result;
  });
  
  return { fields };
}