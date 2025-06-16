import {MongoClient,MongoClientOptions,ReadPreference,Db} from 'mongodb'

const connectToMongoDB = async(url:string,readOnly:boolean):Promise<{client:MongoClient | null,db:Db | null,isConnected:boolean,isReadOnlyMode:boolean}> =>{
    try{
        const options:MongoClientOptions = readOnly ?{readPreference:ReadPreference.SECONDARY} : {}
        const client = new MongoClient(url,options)
        await client.connect()
        const db = client.db()

        console.warn(`Connected to MongoDB database: ${db.databaseName}`)

        return {
            client,db,isConnected:true,isReadOnlyMode:readOnly
        }
    }catch(error){
        console.error("Failed to connect to MongoDB:",error)
        return {
            client:null,
            db:null,
            isConnected:false,
            isReadOnlyMode:readOnly
        }
    }
}

export default connectToMongoDB