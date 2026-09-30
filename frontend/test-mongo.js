const { MongoClient } = require('mongodb');

async function fix() {
    const uri = "mongodb+srv://saurabhkathore31_db_user:JQ3MwCEwm4SDbMfE@cluster0.qdsz4zm.mongodb.net/?appName=Cluster0?retryWrites=true&w=majority";
    const client = new MongoClient(uri);
    try {
        await client.connect();
        const usersDb = client.db('test');
        const farmerDb = client.db('Farmer_Info');

        console.log("=== Updating test.users farmer phone ===");
        const userResult = await usersDb.collection('users').updateOne(
            { email: 'farmer@agribridge.test' },
            { $set: { phone: '7719801363' } }
        );
        console.log("farmer@agribridge.test phone → 7719801363 :", userResult.modifiedCount, "modified");

        console.log("\n=== Updating Farmer_Info.products: Saurabh Kathore → 7719801363 ===");
        const saurabhResult = await farmerDb.collection('products').updateMany(
            { contact_name: 'Saurabh Kathore' },
            { $set: { phone_number: '7719801363' } }
        );
        console.log("Saurabh Kathore docs updated:", saurabhResult.modifiedCount);

        console.log("\n=== Updating Farmer_Info.products: Varun / Varun Mhatre → 918369266891 ===");
        const varunResult = await farmerDb.collection('products').updateMany(
            { contact_name: { $in: ['Varun', 'Varun Mhatre'] } },
            { $set: { phone_number: '918369266891' } }
        );
        console.log("Varun Mhatre docs updated:", varunResult.modifiedCount);

        console.log("\n=== Verification ===");
        const phones = await farmerDb.collection('products').distinct('phone_number');
        console.log("Distinct phone_numbers now:", phones);

        const allDocs = await farmerDb.collection('products').find({}, {
            projection: { _id: 0, contact_name: 1, phone_number: 1, product: 1 }
        }).toArray();
        console.log("\nAll contacts:");
        allDocs.forEach(d => console.log(` ${d.contact_name} | ${d.phone_number} | ${d.product}`));

        const farmerUser = await usersDb.collection('users').findOne(
            { email: 'farmer@agribridge.test' },
            { projection: { password: 0 } }
        );
        console.log("\nFarmer user phone now:", farmerUser.phone);

        const matchCount = await farmerDb.collection('products').countDocuments({ phone_number: '7719801363' });
        console.log("Products matching 7719801363 (Saurabh):", matchCount);

    } catch(e) {
        console.error(e);
    } finally {
        await client.close();
    }
}
fix();
