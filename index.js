const express = require('express')
const cors = require('cors');
const app = express();
require('dotenv').config();
const { MongoClient, ServerApiVersion } = require('mongodb');
const port = process.env.PORT || 3000

// middlware
app.use(express.json());
app.use(cors());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@firstproject.7bzasho.mongodb.net/?appName=firstProject`;


const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});


app.get('/', (req, res) => {
  res.send('zap-shift-server is running fine!')
})

async function run() {
  try {
    await client.connect();
    const db = client.db("zap_shift_db");
    const percelCollection = db.collection('parcels')

    // percel api
    app.get('/percels' , async(req,res)=>{
        const result = await percelCollection.find()
        res.send(result)
    })

    // post
    app.post('percels' , async(req,res)=>{
        const percel = req.body;
        const result = await percelCollection.insertOne(percel)
        res.send(result)
    })




    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } 
  finally {
    
  }
}

run().catch(console.dir);





app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})