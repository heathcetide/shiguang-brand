import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AdminCommunityRepository } from "../src/modules/adminCommunity/repository.js";
import { AdminCommunityService } from "../src/modules/adminCommunity/service.js";

const context = { adminUserId: 1, ipAddress: "127.0.0.1", userAgent: "test" };
function repository(overrides:Partial<AdminCommunityRepository>={}):AdminCommunityRepository { return {
  listPosts:async()=>[],softDeletePost:async()=>false,listComments:async()=>[],deleteComment:async()=>false,
  updateEvent:async()=>({kind:"not_found"}),updateQuestion:async()=>({kind:"not_found"}),...overrides,
}; }

describe("admin community module",()=>{
  test("keeps legacy offset and cursor response shapes database-neutral",async()=>{
    let received:unknown;
    const service=new AdminCommunityService(repository({listPosts:async(input)=>{received=input;return [{id:3},{id:2},{id:1}];}}));
    assert.deepEqual(await service.posts({status:"deleted"}),[{id:3},{id:2},{id:1}]);
    const cursorResult=await service.posts({status:"all",pageSize:"2"});
    if(Array.isArray(cursorResult))throw new Error("Expected cursor response");
    assert.deepEqual(cursorResult.items,[{id:3},{id:2}]); assert.equal(typeof cursorResult.nextCursor,"string");
    assert.deepEqual(received,{status:"all",cursorId:null,limit:3});
    await assert.rejects(()=>service.posts({cursor:"not-a-cursor"}),/分页游标无效/);
  });

  test("validates event windows before atomic repository writes",async()=>{
    let input:unknown;
    const service=new AdminCommunityService(repository({updateEvent:async(_id,value)=>{input=value;return {kind:"updated",before:{}};}}));
    await assert.rejects(()=>service.updateEvent(4,{event_start_at:"bad",event_end_at:"bad"},context),/有效/);
    await assert.rejects(()=>service.updateEvent(4,{event_start_at:"2026-09-02",event_end_at:"2026-09-01"},context),/不能早于/);
    assert.deepEqual(await service.updateEvent(4,{event_start_at:"2026-09-01",event_end_at:"2026-09-02"},context),
      {success:true,event_start_at:"2026-09-01",event_end_at:"2026-09-02"});
    assert.deepEqual(input,{startAt:"2026-09-01",endAt:"2026-09-02"});
  });

  test("maps moderation transaction outcomes to stable admin errors",async()=>{
    const service=new AdminCommunityService(repository({updateQuestion:async()=>({kind:"comment_mismatch"}),softDeletePost:async()=>false,deleteComment:async()=>false}));
    await assert.rejects(()=>service.updateQuestion(1,{question_status:"resolved",accepted_comment_id:null},context),/请选择/);
    await assert.rejects(()=>service.updateQuestion(1,{question_status:"resolved",accepted_comment_id:9},context),/不属于/);
    await assert.rejects(()=>service.deletePost(1,context),/未找到/);
    await assert.rejects(()=>service.deleteComment(1,context),/评论不存在/);
  });
});
