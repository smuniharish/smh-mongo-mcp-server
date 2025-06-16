import { Db, MongoClient } from "mongodb";
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Implementation, PingRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { ServerOptions } from '@modelcontextprotocol/sdk/server/index.js'
import { handlePingRequest } from "./schemas/ping.js";
import {aggregateCollectionTool, aggregateToolSchema, countDocumentsTool, CountToolSchema, createIndexesInputTool, CreateIndexesInputToolSchema, insertInputTool, InsertInputToolSchema, queryCollectionTool, queryToolSchema, serverInfoInputTool, ServerInfoInputToolSchema, updateCollectionTool, updateToolSchema} from "./schemas/tools.js"
import { z } from "zod"
import { handleListResourcesRequest, handleListResourcesRequestTool, handleReadResourcesRequest, handleReadResourcesRequestTool } from "./schemas/resource.js";

const createServer = (client: MongoClient, db: Db, isReadOnlyMode: boolean = false, options = {}) => {
    const serverInfo: Implementation = { name: "mongo-mcp", version: "1.0.0", ...options }
    const serverOptions: ServerOptions = { capabilities: { resources: {}, tools: {}, prompts: {} }, ...options }
    const server = new McpServer(serverInfo, serverOptions)

    // server.server.setRequestHandler(PingRequestSchema,async(request)=>await handlePingRequest({request,client,db,isReadOnlyMode}))
    server.tool("ping", async () => {
        return await handlePingRequest({ client, db })
    })

    server.tool("list-mongodb-collections", async () => {
        return await handleListResourcesRequestTool(db)
    })

    const readSchemaToolSchema = z.object({
        collectionName:z.string().describe("Reads and infers the schema of a MongoDB collection.")
    })

    server.tool("read-schema",readSchemaToolSchema.shape , async ({ collectionName }) => {
        return await handleReadResourcesRequestTool(collectionName, db)
    })

    

    server.tool("query-collection",queryToolSchema.shape,async(args)=>{
        return await queryCollectionTool(args,db)
    })
    
    server.tool("aggregate-collection",aggregateToolSchema.shape,async(args)=>{
        return await aggregateCollectionTool(args,db)
    })
    
    server.tool("update-collection",updateToolSchema.shape,async(args)=>{
        return await updateCollectionTool(args,db)
    })
    
    server.tool("serverInfo",ServerInfoInputToolSchema.shape,async(args)=>{
        return await serverInfoInputTool(args,db)
    })
    
    server.tool("insert-collection",InsertInputToolSchema.shape,async(args)=>{
        return await insertInputTool(args,db)
    })
    
    server.tool("create-indexes-collection",CreateIndexesInputToolSchema.shape,async(args)=>{
        return await createIndexesInputTool(args,db)
    })
    
    server.tool("count-collection",CountToolSchema.shape,async(args)=>{
        return await countDocumentsTool(args,db)
    })

    server.resource(
        "mongo-collections",
        "resource://mongo-collections",
        async () => {
            return await handleListResourcesRequest(db)
        }
    );
    server.resource(
        "mongo-collections",
        new ResourceTemplate("resource://mongo-collections/{collectionName}", { list: async () => {
                const collections = await db.listCollections().toArray();

                return {
                    resources: collections.map(c => ({
                        name: c.name,
                        uri: `resource://mongo-collections/${c.name}`,
                        description: `MongoDB Collection: ${c.name}`,
                        mimeType: "application/json"
                    }))
                };
            } }),
        async (uri, { collectionName }) => {
            return await handleReadResourcesRequest(uri, collectionName, db)
        }
    );

    return server
}
export { createServer }