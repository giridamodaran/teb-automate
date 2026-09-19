import { executeLeadWebhookAutomation } from "../src/lib/automation/teb-lead-service";

async function testPartialUpdatePreservation() {
  console.log("🚀 Testing partial update: Updating ONLY 2 custom fields while preserving all existing lead fields...");

  // Send ONLY phone and 2 updated custom fields
  const partialPayload = {
    phone: "+919876543210",
    product: "Solar Hybrid Inverter 5kW",
    connect_confirmation: "Confirmed by Client",
  };

  const res = await executeLeadWebhookAutomation(partialPayload);
  console.log("\n==========================================");
  console.log("PARTIAL UPDATE RESULT:", JSON.stringify(res, null, 2));
  console.log("==========================================");
}

testPartialUpdatePreservation();
