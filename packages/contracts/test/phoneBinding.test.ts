import assert from "node:assert/strict";
import { test } from "node:test";
import {
  phoneBindingSendSchema,
  phoneBindingVerifySchema,
  phoneReplacementSendSchema,
  phoneReplacementVerifySchema,
  reauthSendSchema,
} from "../src/account.ts";
test("first binding accepts only a mainland target and current password, with isolated verification shape", () => {
  assert.equal(phoneBindingSendSchema.parse({phone:"+8613800223001",currentPassword:"old-password"}).phone,"13800223001");
  for (const phone of ["+14155550123","123","8613800223001"]) assert.equal(phoneBindingSendSchema.safeParse({phone,currentPassword:"old"}).success,false);
  for (const input of [{phone:"13800223001"},{phone:"13800223001",currentPassword:"old",userId:2}]) assert.equal(phoneBindingSendSchema.safeParse(input).success,false);
  assert.equal(reauthSendSchema.safeParse({purpose:"phone_bind"}).success,false);
  assert.equal(phoneBindingVerifySchema.safeParse({challengeId:"not-a-uuid",code:"123456"}).success,false);
  assert.equal(phoneBindingVerifySchema.safeParse({challengeId:"00000000-0000-4000-8000-000000000001",code:"123456",phone:"13800223001"}).success,false);
});

test("replacement accepts mainland new phone with current password", () => {
  assert.deepEqual(phoneReplacementSendSchema.parse({newPhone:"+8613800223002",currentPassword:"password123"}), {newPhone:"13800223002",currentPassword:"password123"});
  for (const phone of ["+14155550123","123","invalid"]) {
    assert.equal(phoneReplacementSendSchema.safeParse({newPhone:phone,currentPassword:"pass"}).success,false);
  }
  assert.equal(phoneReplacementSendSchema.safeParse({newPhone:"13800223002"}).success,false);
  assert.equal(phoneReplacementSendSchema.safeParse({newPhone:"13800223002",currentPassword:""}).success,false);
  assert.equal(phoneReplacementVerifySchema.safeParse({challengeId:"00000000-0000-4000-8000-000000000002",code:"654321"}).success,true);
  assert.equal(phoneReplacementVerifySchema.safeParse({challengeId:"not-uuid",code:"654321"}).success,false);
  assert.equal(phoneReplacementVerifySchema.safeParse({challengeId:"00000000-0000-4000-8000-000000000002",code:"123"}).success,false);
});
