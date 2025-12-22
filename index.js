const express = require('express')
const cors = require('cors');
const app = express();
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET);
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
    const percelCollection = db.collection('percels')

    // percel api
    app.get('/percels', async (req, res) => {
      const query = {}
      const { email } = req.query;
      if (email) {
        query.email = email;
      }
      const result = await percelCollection.find(query).sort({ bookingDate: -1 }).toArray()
      res.send(result)
    })


    // single percel id for payment
    app.get('/percels/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const result = await percelCollection.findOne(query)
      res.send(result)
    })

    // post
    app.post('/percels', async (req, res) => {
      const percel = req.body;
      const result = await percelCollection.insertOne(percel)
      res.send(result)
    })

    // delete
    app.delete('/percels/:id', async (req, res) => {
      const id = req.params.id
      const query = { _id: new ObjectId(id) }
      const result = await percelCollection.deleteOne(query);
      res.send(result)
    })


    // payment related apis
    app.post('/create-checkout-session', async (req, res) => {
      const paymentInfo = req.body;
      const amount = parseInt(paymentInfo.cost) * 100
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: 'USD',
              unit_amount: amount,
              product_data: {
                name: paymentInfo.parcelName
              },
            },

            quantity: 1,
          },
        ],
        customer_email: paymentInfo.email,
        mode: 'payment',
        metadata: {
          parcelId: paymentInfo.parcelId
        },
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
      })
      console.log(session);
      res.send({ url: session.url })

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