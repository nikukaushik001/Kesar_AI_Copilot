// Return Eligibility & Business Logic Node (JavaScript for n8n Code Node)
// Computes deterministic dates, handles privacy checks, and tickets requirements

const item = $input.first().json;
const email = item.email || item;
const classification = item.classification || {};
const order = item.order || null;

const SCENARIO_DATE = "2026-11-20"; // Reference date
const emailDateStr = email.received_at ? email.received_at.split("T")[0] : SCENARIO_DATE;
const emailDate = new Date(emailDateStr);

let eligibility = {
  is_eligible: false,
  reason: "",
  days_since_delivery: null,
  requires_photos: false,
  privacy_passed: true
};

let needs_human = false;
let action_taken = "log_only";
let ticket_priority = "Normal";
let notes = [];

// 1. Confidence check
if (classification.confidence < 0.70) {
  needs_human = true;
  notes.push("Low classification confidence (< 0.70)");
}

// 2. Privacy Check: Only share order details if sender matches customer_email
if (order) {
  const senderEmail = (email.from && email.from.email) ? email.from.email.toLowerCase().trim() : "";
  const orderEmail = (order.customer_email || "").toLowerCase().trim();
  if (senderEmail !== orderEmail) {
    eligibility.privacy_passed = false;
    needs_human = true;
    notes.push(`Privacy check failed: Sender ${senderEmail} does not match order email ${orderEmail}`);
  }
}

// 3. Routing & Eligibility Rules
const intent = classification.intent;

if (intent === "order_status") {
  if (!order) {
    action_taken = "needs_human";
    needs_human = true;
    notes.push("Order not found by ID or sender email");
  } else if (!eligibility.privacy_passed) {
    action_taken = "privacy_block_draft";
  } else {
    action_taken = "draft_reply";
  }
} else if (intent === "product_query") {
  // Check if medical claim or safety issue
  const bodyText = (email.body || "").toLowerCase();
  const medicalKeywords = ["cure", "eczema", "psoriasis", "allergy", "reaction", "rash", "pregnant", "pregnancy", "dermatologist"];
  const containsMedical = medicalKeywords.some(kw => bodyText.includes(kw));
  
  if (containsMedical) {
    needs_human = true;
    action_taken = "escalate_medical_query";
    notes.push("Medical/Safety inquiry detected - escalated to human");
  } else {
    action_taken = "draft_reply";
  }
} else if (intent === "return_refund" || intent === "complaint") {
  // Return / Complaint logic
  const isComplaint = intent === "complaint";
  ticket_priority = isComplaint ? "High" : "Normal";
  
  // Calculate delivery date diff if delivered
  if (order && order.delivered_date) {
    const deliveredDate = new Date(order.delivered_date);
    const diffTime = Math.abs(emailDate - deliveredDate);
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    eligibility.days_since_delivery = diffDays;

    if (isComplaint) {
      // Damaged/Wrong/Missing items must be reported within 48 hours (2 days)
      if (diffDays <= 2) {
        eligibility.is_eligible = true;
        eligibility.requires_photos = true;
        eligibility.reason = `Reported within ${diffDays} day(s) of delivery (<= 48 hrs window). Eligible for free replacement/refund upon photo proof.`;
      } else {
        eligibility.is_eligible = false;
        eligibility.reason = `Reported ${diffDays} days after delivery (exceeds 48 hrs damage policy).`;
        needs_human = true;
      }
    } else {
      // Standard return: within 7 days of delivery, unopened
      if (diffDays <= 7) {
        eligibility.is_eligible = true;
        eligibility.reason = `Reported ${diffDays} days after delivery (<= 7 days window). Eligible if unused and sealed.`;
      } else {
        eligibility.is_eligible = false;
        eligibility.reason = `Delivered ${diffDays} days ago (exceeds 7-day return policy). Ineligible for return.`;
      }
    }
  } else if (!order) {
    needs_human = true;
    notes.push("Order not found for return/complaint");
  }

  action_taken = isComplaint ? "ticket_and_draft_complaint" : "ticket_and_draft_return";
} else { // other
  action_taken = "log_only";
  const bodyText = (email.body || "").toLowerCase();
  if (bodyText.includes("collab") || bodyText.includes("partner") || bodyText.includes("gst")) {
    action_taken = "route_partnerships_or_finance";
  }
}

return {
  json: {
    ...item,
    eligibility,
    needs_human,
    action_taken,
    ticket_priority,
    notes: notes.join("; ")
  }
};
