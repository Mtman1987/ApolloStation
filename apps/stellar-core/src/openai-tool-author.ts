export interface AuthorTool { name:string; description:string; parameters:Record<string,unknown>; run(args:Record<string,unknown>):Promise<unknown>|unknown; }

/** Shared hosted inference adapter. App tools supply scoped data; the model never receives credentials. */
export class OpenAiToolAuthor {
  constructor(private readonly options:{apiKey:string;fetchImpl?:typeof fetch}){}
  async run(input:{model:"gpt-5.6-sol"|"gpt-5.6-luna";instructions:string;request:string;tools:AuthorTool[];signal:AbortSignal}) {
    const conversation:unknown[]=[{role:"user",content:input.request}];
    const usage={inputTokens:0,outputTokens:0,requests:0};
    for(let turn=0;turn<10;turn++){
      input.signal.throwIfAborted();
      const response=await(this.options.fetchImpl??fetch)("https://api.openai.com/v1/responses",{method:"POST",headers:{authorization:`Bearer ${this.options.apiKey}`,"content-type":"application/json"},body:JSON.stringify({model:input.model,instructions:input.instructions,input:conversation,store:false,max_output_tokens:6000,reasoning:{effort:"low"},parallel_tool_calls:false,tool_choice:"required",tools:input.tools.map(({name,description,parameters})=>({type:"function",name,description,parameters,strict:true}))}),signal:input.signal,redirect:"error"});
      if(!response.ok)throw Error(`OpenAI authoring returned HTTP ${response.status}${response.status===401?": check the configured API key":response.status===429?": check API quota or rate limits":""}`);
      const body=await response.json() as {output?:Array<Record<string,unknown>>;usage?:{input_tokens:number;output_tokens:number};status?:string};
      usage.requests++;usage.inputTokens+=body.usage?.input_tokens??0;usage.outputTokens+=body.usage?.output_tokens??0;
      if(body.status!=="completed")throw Error("OpenAI could not complete the authoring response within its output limit");
      conversation.push(...body.output??[]);
      const calls=(body.output??[]).filter(item=>item.type==="function_call");
      if(!calls.length)throw Error("The author did not submit a flow or request a tool");
      for(const call of calls){
        let result:unknown;
        try{const tool=input.tools.find(t=>t.name===call.name);if(!tool)throw Error("Unknown authoring tool");const args=JSON.parse(String(call.arguments));result=await tool.run(args);}catch(error){result={error:error instanceof Error?error.message:"Tool failed"};}
        if(call.name==="submit_flow"&&(result as {accepted?:boolean})?.accepted)return usage;
        conversation.push({type:"function_call_output",call_id:call.call_id,output:JSON.stringify(result)});
      }
    }
    throw Error("Flow authoring reached its ten-request limit. Review the request and try a smaller change.");
  }
}
