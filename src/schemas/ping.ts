import { PingRequest } from "@modelcontextprotocol/sdk/types.js"
import { Db, MongoClient } from "mongodb"
interface HandlePingRequestI {
    client:MongoClient,db:Db
}

const handlePingRequest = async(options:HandlePingRequestI) =>{
    const {client,db} = options
    try{
        if(!client){
            throw new Error("MongoDB connection is not available")
        }

        const pong = await db.command({ping:1})

        if(pong.ok !== 1){
            throw new Error(`MongoDB ping failed: ${pong.errmsg}`)
        }

        return {
            content:[
                {
                    type:"text" as const,
                    text:"MongoDB is alive! Pong!"
                }
            ]
        };
    }catch(error:any){
        return {
            content:[
                {
                    type:"text" as const,
                    text: `MongoDB ping failed: ${error?.message}`
                }
            ],
            isError:true
        }
    }
}
export {handlePingRequest}