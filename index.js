const express = require('express')
const cors = require('cors');
const app = express();
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET);
const crypto = require("crypto")
const port = process.env.PORT || 3000
const admin = require("firebase-admin");

const serviceAccount = require("./zap-shit-firebase-adminsdk.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});



// function to create traacikking id
const generateTrackingId = () => {
  const prefix = "PRCL";
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const random = crypto.randomBytes(4).toString("hex").toUpperCase();

  return `${prefix}-${date}-${random}`;
};




// middlware
app.use(express.json());
app.use(cors());

// verify firebase token
const verifyFBToken = async (req, res, next) => {
  // console.log('headers in the middleware', req.headers.authorization);
  const token = req.headers.authorization;

  if (!token) {
    return res.status(401).send({ message: "unauthorized access" })
  }

  try {
    const idToken = token.split(' ')[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    // console.log('decoded in the token', decoded);
    req.decoded_email = decoded.email;
    next();

  }
  catch (err) {
    return res.status(401).send({ message: 'unauthorized access' })
  }

}

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
    const percelCollection = db.collection('percels');
    const paymentCollection = db.collection('payments');
    const userCollection = db.collection('users');
    const ridersCollection = db.collection('riders');


    // -------middleware with database access------
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded_email;
      const query = { email };
      const user = await userCollection.findOne(query);

      if (!user || user.role !== 'admin') {
        return res.status(403).send({ message: "Forbidden Access" })
      }

      next()
    }


    //-------------- user related api------------------
    app.post('/users', async (req, res) => {
      const user = req.body;
      user.role = 'user';
      user.createdAt = new Date();
      const email = user.email;

      const userExist = await userCollection.findOne({ email })
      if (userExist) {
        return res.send({ message: 'user Already Exist' })
      }
      const result = await userCollection.insertOne(user);
      res.send(result)
    })

    // get
    app.get('/users', verifyFBToken, async (req, res) => {
      const searchText = req.query.searchText;
      const query = {};
      if (searchText) {
        query.displayName = { $regex: searchText, $options: 'i' };

      }
      const result = await userCollection.find(query).toArray()
      res.send(result);
    })


    // get by id
    app.get('/users/:id', async (req, res) => {

    })


    // get by email
    app.get('/users/:email/role', async (req, res) => {
      const email = req.params.email;
      const query = { email }
      const user = await userCollection.findOne(query)
      res.send({ role: user?.role || 'user' })
    })

    // patch
    app.patch('/users/:id/role', verifyFBToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const roleInfo = req.body;
      const query = { _id: new ObjectId(id) }
      const updatedDoc = {
        $set: {
          role: roleInfo.role
        }
      }
      const result = await userCollection.updateOne(query, updatedDoc)
      res.send(result)
    }
    )





    //-------------- percel related api-------------------
    app.get('/percels', async (req, res) => {
      const query = {}
      const { email, deliveryStatus } = req.query;
      if (email) {
        query.email = email;
      }
      if (deliveryStatus) {
        query.deliveryStatus = deliveryStatus;
      }
      const result = await percelCollection.find(query).sort({ bookingDate: -1 }).toArray()
      res.send(result)
    })


    // patch
    app.patch('/percels/:id', async (req, res) => {
      const { riderId,
        riderEmail,
        riderName
       } = req.body;
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }

      const updatedDoc = {
        $set: {
          deliveryStatus: 'driver-assigned',
          riderId: riderId,
          riderName: riderName,
          riderEmail: riderEmail
        }
      }

      const result = await percelCollection.updateOne(query, updatedDoc)

      // update rider info
      const riderQuery = { _id: new ObjectId(riderId) }
      const riderUpdatedDoc = {
        $set: {
          workStatus: 'in-delivery'
        }
      }
      const riderResult = await ridersCollection.updateOne(riderQuery, riderUpdatedDoc)
      res.send({
        modifiedCount: result.modifiedCount,
        parcelResult: result,
        riderResult,
      });

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


    //-------------------- payment api----------------------

    // payment related apis alternative new
    app.post('/payment-checkout-session', async (req, res) => {
      const paymentInfo = req.body;
      const amount = parseInt(paymentInfo.cost) * 100;
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: 'usd',
              unit_amount: amount,
              product_data: {
                name: `please pay for ${paymentInfo.parcelName}`
              }
            },
            quantity: 1,
          },
        ],
        mode: 'payment',
        customer_email: paymentInfo.email,
        metadata: {
          parcelId: paymentInfo.parcelId,
          parcelName: paymentInfo.parcelName
        },
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
      });
      res.send({ url: session.url })

    })



    // payment related apis old
    app.post('/create-checkout-session', async (req, res) => {
      const paymentInfo = req.body;
      const amount = parseInt(paymentInfo.cost) * 100;
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
          parcelId: paymentInfo.parcelId,
          parcelName: paymentInfo.parcelName
        },
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
      })
      console.log(session);
      res.send({ url: session.url })

    })


    // update api

    // app.patch('/payment-success', async (req, res) => {
    //   const sessionId = req.query.session_id;

    //   const session = await stripe.checkout.sessions.retrieve(sessionId);
    //   const trackingId = generateTrackingId();


    //   // check the transactionId if available in db it will be not duplicate
    //   const transactionId = session.payment_intent;
    //   const query = {transactionId: transactionId}
    //   const paymentExist = await paymentCollection.findOne(query);
    //   console.log(paymentExist);

    //   if(paymentExist){
    //     return res.send({ 
    //       message: " Already Exists" ,
    //        transactionId,
    //         trackingId:paymentExist.trackingId
    //       })
    //   }

    //   if (session.payment_status === 'paid') {
    //     const id = session.metadata.parcelId;
    //     const query = { _id: new ObjectId(id) }
    //     const update = {
    //       $set: {
    //         paymentStatus: 'paid',
    //         trackingId: trackingId
    //       }
    //     }
    //     const result = await percelCollection.updateOne(query, update);
    //     const payment = {
    //       amount: session.amount_total / 100,
    //       currency: session.currency,
    //       customerEmail: session.customer_email,
    //       parcelId: session.metadata.parcelId,
    //       parcelName: session.metadata.parcelName,
    //       transactionId: session.payment_intent,
    //       trackingId: trackingId,
    //       paymentStatusL: session.payment_status,
    //       paidAt: new Date(),



    //     }
    //     if (session.payment_status === 'paid') {
    //       const resultPayment = await paymentCollection.insertOne(payment);
    //       res.send({ 
    //          success: true,
    //          modifyParcel: result,
    //          trackingId: trackingId,
    //          transactionId: session.payment_intent,
    //           paymentInfo: resultPayment })
    //     }

    //   }
    //   res.send({ success: false })

    // })





    // api patch
    app.patch('/payment-success', async (req, res) => {
      try {
        const sessionId = req.query.session_id;
        const session = await stripe.checkout.sessions.retrieve(sessionId);

        if (session.payment_status !== 'paid') {
          return res.status(400).send({ success: false });
        }

        const transactionId = session.payment_intent;

        // 🔒 UPSERT payment
        const paymentResult = await paymentCollection.updateOne(
          { transactionId },
          {
            $setOnInsert: {
              amount: session.amount_total / 100,
              currency: session.currency,
              customerEmail: session.customer_email,
              parcelId: session.metadata.parcelId,
              parcelName: session.metadata.parcelName,
              transactionId,
              trackingId: generateTrackingId(),
              paymentStatus: 'paid',
              paidAt: new Date(),

            }
          },
          { upsert: true }
        );

        // update parcel only once
        await percelCollection.updateOne(
          { _id: new ObjectId(session.metadata.parcelId) },
          {
            $set: {
              paymentStatus: 'paid',
              deliveryStatus: 'pending-pickup'

            }
          }
        );

        res.send({
          success: true,
          transactionId,
        });

      } catch (error) {
        console.error(error);
        res.status(500).send({ success: false });
      }
    });



    //-------------------- payment related api-----------------
    app.get('/payments', verifyFBToken, async (req, res) => {
      const email = req.query.email;
      const query = {};
      // console.log('headers', req.headers);

      if (email) {
        query.customerEmail = email;
        // check the email
        if (email !== req.decoded_email) {
          return res.status(403).send({ message: "Forbidden Access" })
        }
      }
      const result = await paymentCollection.find(query).sort({ paidAt: -1 }).toArray();
      res.send(result)
    })


    // ---------------------rider related api------------------------

    // rider get
    app.get('/riders', async (req, res) => {
      const { status, district, workStatus } = req.query;
      const query = {}
      if (status) {
        query.status = req.query.status
      }
      if (district) {
        query.district = { $regex: `^${district}$`, $options: 'i' };
      }
      // if(workStatus){
      //   query.workStatus = workStatus
      // }
      const result = await ridersCollection.find(query).toArray();
      res.send(result)
    })

    // single rider details get
    app.get('/riders/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const result = await ridersCollection.findOne(query)
      res.send(result);
    })


    //rider post
    app.post('/riders', async (req, res) => {
      const rider = req.body;
      rider.status = 'pending';
      rider.createdAt = new Date();

      const result = await ridersCollection.insertOne(rider)
      res.send(result)
    })


    // rider patch
    app.patch('/riders/:id', verifyFBToken, verifyAdmin, async (req, res) => {
      const status = req.body.status;
      const id = req.params.id
      const query = { _id: new ObjectId(id) }
      const updatedDoc = {
        $set: {
          status: status
        }
      }

      const result = await ridersCollection.updateOne(query, updatedDoc);
      if (status === 'approved') {
        const email = req.body.email;
        const userQuery = { email }
        const updateUser = {
          $set: {
            role: 'rider'
          }
        }
        const userResult = await userCollection.updateOne(userQuery, updateUser)
      }
      res.send(result);
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