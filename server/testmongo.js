require("dotenv").config();

const { MongoClient } = require("mongodb");

async function test(){

    console.log("URL:", process.env.MONGO_URL);

    const client = new MongoClient(process.env.MONGO_URL);

    await client.connect();

    console.log("MongoDB CONNECTED");

    await client.close();

}

test().catch(err=>{
    console.error("Mongo ERROR:");
    console.error(err);
});