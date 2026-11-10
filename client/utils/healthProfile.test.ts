import { findRecipeAllergyRisks, hasSafetyProfile, safetySummary, type HealthProfile } from "./healthProfile";

describe("health profile safety helpers", () => {
  const profile: HealthProfile = {
    allergies: [
      { name: "坚果", type: "allergy", severity: "severe" },
      { name: "乳糖", type: "intolerance", severity: "moderate" },
    ],
    medical_conditions: ["高血压"],
    dietary_restrictions: ["低盐"],
    medications: "维生素 D，早餐后",
  };

  test("matches common aliases used in recipe ingredients", () => {
    const risks = findRecipeAllergyRisks(["烤腰果", "希腊酸奶", "菠菜"], profile.allergies);
    expect(risks.map((item) => item.name)).toEqual(["坚果", "乳糖"]);
  });

  test("summarizes only user-provided safety constraints", () => {
    expect(hasSafetyProfile(profile)).toBe(true);
    expect(safetySummary(profile)).toEqual([
      "过敏/不耐受：坚果（重度）、乳糖（中度）",
      "健康状态：高血压",
      "饮食限制：低盐",
      "已记录用药/补充剂时段",
    ]);
  });
});
