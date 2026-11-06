import { Agent } from '@earendil-works/pi-agent-core';
import { AssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream';
import { abortable, copy, emptyUsage, estimateTokens, makeDraftRequest, makeRequest, MAX_PROMPT_BYTES, misplacedQuestionsCandidate, parseDraftData, parseEnvelope, requestSize, sameJson, validateBudget, validateDraftFields } from './transport.mjs';

export const VERSION = '1.4.0';
export const LIMITS = Object.freeze({modelCalls: 8, toolCalls: 12, wallMs: 180000});
const message = (content, stopReason = 'stop', errorMessage) => ({role: 'assistant', content,
    api: 'text-envelope', provider: 'shared', model: 'configured', usage: emptyUsage(), stopReason,
    timestamp: Date.now(), ...(errorMessage ? {errorMessage} : {})});
const interrupted = call => ({role: 'toolResult', toolCallId: call.id, toolName: call.name,
    content: [{type: 'text', text: 'Tool execution interrupted; result unknown. Historical calls are never replayed.'}],
    isError: true, timestamp: Date.now()});

// Preserve completed pairs, close interrupted calls with an explicit error result, and
// reject orphan/duplicate results rather than silently changing historical evidence.
function repairPairs(messages) {
    const repaired = [], pending = new Map(), known = new Set();
    function close() {for (const call of pending.values()) repaired.push(interrupted(call)); pending.clear();}
    for (const m of messages) {
        if (m.role !== 'toolResult') close();
        if (m.role === 'assistant') {
            for (const c of m.content.filter(c => c.type === 'toolCall')) {
                if (known.has(c.id)) throw Error('Duplicate historical Pico tool call id');
                known.add(c.id); pending.set(c.id, c);
            }
        } else if (m.role === 'toolResult') {
            const call = pending.get(m.toolCallId);
            if (!call || call.name !== m.toolName) throw Error('Orphan historical Pico tool result');
            pending.delete(m.toolCallId);
        }
        repaired.push(m);
    }
    close();
    return repaired;
}
function restore(messages) {
    if (!Array.isArray(messages)) throw Error('Pico messages must be an array');
    const values = copy(messages).filter(m => m.role !== 'system');
    for (let i = 0; i < values.length; i++) {
        const m = values[i];
        if (!['user', 'assistant', 'toolResult'].includes(m.role)) throw Error('Invalid Pico message role');
        if (m.role === 'user') {
            if (typeof m.content !== 'string' && (!Array.isArray(m.content) || m.content.some(p => p.type !== 'text' || typeof p.text !== 'string'))) throw Error('Invalid Pico user message');
        } else {
            if (!Array.isArray(m.content)) throw Error('Invalid Pico message content');
            m.content = m.content.filter(p => p.type !== 'thinking');
            for (const part of m.content) {
                if (part.type === 'text' && typeof part.text === 'string') continue;
                if (m.role === 'assistant' && part.type === 'toolCall' && typeof part.id === 'string' && typeof part.name === 'string' && part.arguments && typeof part.arguments === 'object' && !Array.isArray(part.arguments)) continue;
                throw Error('Invalid Pico message content');
            }
            if (m.role === 'assistant') values[i] = {...message(m.content, m.stopReason || 'stop'), ...m};
            if (m.role === 'toolResult' && (typeof m.toolCallId !== 'string' || typeof m.toolName !== 'string')) throw Error('Invalid Pico tool result');
        }
    }
    return repairPairs(values);
}

// Existing Jira-style questions may be returned with an id, reason and text.
// Treat them only as gaps in a local proposal, never as commands.
function reviewQuestions(missing, state, proposed) {
    const questions=[],notes=[];
    for (const entry of missing) {
        const item=typeof entry==='string'?{text:entry}:entry;
        if(!item || typeof item!=='object' || Array.isArray(item) ||
            Object.keys(item).some(k=>!['id','text','reason','required'].includes(k)) ||
            typeof item.text!=='string' || !item.text.trim() ||
            (item.reason!==undefined && typeof item.reason!=='string') ||
            (item.id!==undefined && typeof item.id!=='string') ||
            (item.required!==undefined && typeof item.required!=='boolean')) throw Error('Invalid missing question');
        const fieldId=typeof item.id==='string' && /^required:([a-zA-Z][a-zA-Z_0-9]*)$/.exec(item.id)?.[1];
        const asksAssignee=fieldId==='assignee' || (!fieldId && /(?:кто[^?]{0,35}исполнител|кого назначить|укажите исполнителя|нужно ли[^?]{0,32}исполнител|кто (?:выполнит|выполняет) работ)/i.test(item.text));
        const spec=(fieldId || asksAssignee) && state.fieldSchema.find(f=>f.id===(fieldId || 'assignee'));
        if(spec && state.draft.userFieldsPresent?.[fieldId])continue;
        if(spec && asksAssignee && !spec.required) {
            const userRemarks=state.conversationForReview.filter(m=>m.role==='user' && /исполнител|assignee/i.test(m.text));
            const last=userRemarks.at(-1)?.text || '';
            if(/не (?:нужно|надо|требуется|назначать)|без исполнителя/i.test(last)){
                notes.push(last);continue;
            }
        }
        if(!questions.some(q=>q.text===item.text.trim()))
            questions.push({id:'gap_'+questions.length,text:item.text.trim(),reason:item.reason || '',required:item.required!==false});
    }
    if(notes.length && typeof proposed.description==='string')for(const note of notes) {
        if(!proposed.description.includes(note))proposed.description+='\n\nСо слов пользователя: '+note;
    }
    return questions;
}

export function createSession({system = '', messages = [], tools = [], requestText, tokenBudget, onEvent = () => {}, getContext, limits = {}, allowPlainTextFinal = false, repairMisplacedQuestions = false, appManagedPatch = false, currentTurnWithEvidence = false, afterStep, draftReviewPrompt, draftExtractionPrompt} = {}) {
    if (typeof requestText !== 'function') throw Error('Pico requires the configured shared requestText callback');
    if (typeof system !== 'string' || typeof onEvent !== 'function' || (getContext !== undefined && typeof getContext !== 'function')) throw Error('Invalid Pico session options');
    const budget = validateBudget(tokenBudget), bounds = {};
    for (const [key, hardLimit] of Object.entries(LIMITS)) {
        if (limits[key] !== undefined && (!Number.isSafeInteger(limits[key]) || limits[key] <= 0)) throw Error('Invalid Pico turn limit');
        bounds[key] = Math.min(hardLimit, limits[key] ?? hardLimit);
    }
    if (!Array.isArray(tools)) throw Error('Pico tools must be an array');
    const names = new Set();
    tools = tools.map(t => {
        if (!t || typeof t.name !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(t.name) || names.has(t.name) ||
            typeof t.execute !== 'function' || !t.parameters || t.parameters.type !== 'object') throw Error('Invalid Pico tool declaration');
        names.add(t.name);
        return {...t, description: String(t.description || ''), parameters: copy(t.parameters)};
    });
    let active = null, disposed = false;
    const restored = restore(messages);
    const seenIds = new Set(restored.filter(m => m.role === 'assistant').flatMap(m => m.content.filter(c => c.type === 'toolCall').map(c => c.id)));
    function emit(event) {
        try {Promise.resolve(onEvent(copy(event))).catch(() => {});} catch { /* Observers do not own the loop. */ }
    }
    function stop(status, reason) {
        if (!active || active.status) return;
        active.status = status; active.reason = reason;
        if (status === 'limit') emit({type: 'limit', reason, message: reason});
        active.controller.abort(); agent.abort();
    }
    function limit(reason) {stop('limit', reason); throw Error(reason);}
    function live(run, signal) {
        if (!run || active !== run || run.status || signal?.aborted) throw Error(run?.reason || 'Operation aborted');
        // Timers cannot run while synchronous callback work occupies the event loop.
        if (Date.now() - run.started >= bounds.wallMs) limit('Pico wall time limit reached (maximum ' + bounds.wallMs + ' ms per turn).');
    }
    const executableTools = tools.map(t => ({...t, label: t.name, executionMode: 'sequential', replay: 'never',
        async execute(toolCallId, args, signal, onUpdate) {
            const run = active;
            live(run, signal);
            const result = await abortable(Promise.resolve().then(() => {
                live(run, signal);
                return t.execute(copy(args), {signal, toolCallId, onUpdate(value) {
                    if (active !== run || run.status || signal?.aborted) return;
                    const safe = copy(value);
                    onUpdate?.({content: [{type: 'text', text: JSON.stringify(safe)}], details: safe});
                }});
            }), signal);
            live(run, signal);
            const safe = copy(result);
            // Never truncate evidence: a large result stays in history; the next model
            // request either fits or visibly stops on the configured context bound.
            return {content: [{type: 'text', text: JSON.stringify(safe)}], details: safe};
        }}));
    const streamFn = (_model, context, {signal} = {}) => {
        const output = new AssistantMessageEventStream(), run = active;
        void (async () => {
            try {
                live(run, signal);
                if (run.usage.modelCalls >= bounds.modelCalls) limit('Pico model call limit reached (maximum ' + bounds.modelCalls + ' per turn).');
                let state = getContext ? copy(await abortable(Promise.resolve().then(() => getContext()), signal)) : null;
                live(run, signal);
                const full = context.messages.filter(m => m.role !== 'system');
                // A review request supplies the saved user conversation as authoritative
                // evidence. Keep prior protocol messages for restore/ID guards without
                // sending a second copy of that history on every review step.
                let projected = full, compaction = null;
                if (currentTurnWithEvidence && (Array.isArray(state?.conversationForReview) || Array.isArray(state?.conversationForTask))) {
                    const start = full.findLastIndex(m => m.role === 'user');
                    if (start > 0) {
                        projected = full.slice(start);
                        state.usedToolCallIds = [...seenIds];
                    }
                }
                function buildRequest() {
                    if (!draftReviewPrompt) return makeRequest(system, tools, projected, state, compaction, appManagedPatch);
                    // Reconciliation is a single, scoped local field update. The
                    // model supplies field data; the application owns call IDs and
                    // runs the same schema, scope and concurrency checks as chat.
                    return makeDraftRequest(draftReviewPrompt, state, state.conversationForReview, {messages:projected});
                }
                let request = buildRequest(), size = requestSize(request);
                const fits = () => size.tokens <= budget.context - budget.reserve && size.bytes <= MAX_PROMPT_BYTES;
                if (!fits() && getContext && !draftReviewPrompt) {
                    // Compact only complete older user turns. Keep the current user turn,
                    // all its tool-call/result pairs, and fresh authoritative application state.
                    const starts = full.flatMap((m, i) => m.role === 'user' ? [i] : []);
                    for (const index of starts.slice(1)) {
                        projected = full.slice(index);
                        compaction = {removedMessages: index, message: 'Earlier complete turns omitted from model context. Full transcript remains stored; use current authoritative task, manual fields, open questions and template revisions.'};
                        request = makeRequest(system, tools, projected, state, compaction, appManagedPatch); size = requestSize(request);
                        if (fits()) break;
                    }
                }
                if (!fits()) limit('Pico context limit reached: instructions, tools, current turn and authoritative state must fit with the configured response reserve. History is preserved.');
                if (compaction) {run.usage.compactions++; emit({type: 'compaction', ...compaction});}
                async function ask() {
                    live(run, signal);
                    if(draftReviewPrompt && run.usage.modelCalls>=2)throw Error('Pico draft update missing');
                    if (run.usage.modelCalls >= bounds.modelCalls) limit('Pico model call limit reached (maximum ' + bounds.modelCalls + ' per turn).');
                    if (!fits()) limit('Pico context limit reached: corrective request must fit with the configured response reserve. History is preserved.');
                    run.usage.modelCalls++; run.usage.inputTokens += size.tokens;
                    const response = await abortable(Promise.resolve().then(() => {
                        live(run, signal); return requestText({...request, signal});
                    }), signal);
                    live(run, signal);
                    if (!response || typeof response.text !== 'string') throw Error('Shared requestText returned no text');
                    const tokens = estimateTokens(response.text);
                    run.usage.outputTokens += tokens;
                    if (tokens > budget.reserve) limit('Pico response reserve exceeded. Response was not applied; history is preserved.');
                    return {response, tokens};
                }
                let {response, tokens} = await ask(), envelope;
                const readDraft = (raw, strict = false) => {
                    const value = parseDraftData(raw, state.fieldSchema);
                    if (!value || Object.keys(value).sort().join(',') !== 'fields,missing' ||
                        !Array.isArray(value.missing)) throw Error('Invalid draft');
                    if (state.generationFieldIds.includes('description') && (typeof value.fields?.description!=='string' || !value.fields.description.trim())) throw Error('Missing description');
                    let seq=seenIds.size+1;
                    while(seenIds.has('draft_'+seq))seq++;
                    const args={fields:value.fields,questions:reviewQuestions(value.missing,state,value.fields)};
                    if (strict) validateDraftFields(args.fields, state);
                    return parseEnvelope(JSON.stringify({text:'',toolCalls:[{id:'draft_'+seq,name:'update_task',arguments:args}]}),tools,seenIds);
                };
                if (draftReviewPrompt) {
                    try {envelope=readDraft(response.text);}
                    catch {
                        if(run.reformatted)throw Error('Pico draft update missing');
                        run.reformatted=true;
                        request={...request,system:request.system+' Предыдущий ответ не применён. Напиши один корректный JSON с двумя ключами fields и missing. Без служебных команд, префиксов или Markdown.'};
                        size=requestSize(request);
                        ({response,tokens}=await ask());
                        try {envelope=readDraft(response.text);} catch {throw Error('Pico draft update missing');}
                    }
                } else try {envelope = parseEnvelope(response.text, tools, seenIds, allowPlainTextFinal, appManagedPatch);} catch (error) {
                    const code = error.message==='Duplicate Pico tool call id' ? 'duplicate-call-id' :
                        error.message.startsWith('Invalid arguments for Pico tool:') ? 'tool-schema' : 'envelope';
                    emit({type:'response-rejected', code});
                    const candidate = repairMisplacedQuestions === true && !run.reformatted ? misplacedQuestionsCandidate(response.text, tools, seenIds) : null;
                    if (!candidate) {
                        if (!draftExtractionPrompt || run.reformatted || !getContext) throw error;
                        run.reformatted = true;
                        // Re-read authoritative state; never use the invalid response as
                        // factual evidence or salvage any of its requested commands.
                        state = copy(await abortable(Promise.resolve().then(() => getContext({purpose:'draft-extraction'})), signal));
                        live(run, signal);
                        const evidence = state.conversationForExtraction;
                        if (!Array.isArray(evidence) || !evidence.some(m=>m.role==='user' && m.text.trim())) throw error;
                        state.conversationForReview = evidence;
                        request = makeDraftRequest(draftExtractionPrompt, state, evidence, {includeSource:false});
                        size = requestSize(request);
                        ({response,tokens} = await ask());
                        try {envelope = readDraft(response.text, true);} catch {throw Error('Pico response correction failed');}
                        run.extracted = true;
                    } else {
                        run.reformatted = true;
                        state = getContext ? copy(await abortable(Promise.resolve().then(() => getContext()), signal)) : null;
                        live(run, signal);
                        request = makeRequest(system + '\nReformat the previous invalid response exactly once. No tools from it were executed. Move update_task questions inside arguments; preserve all text, IDs, names and argument values. Return the complete original batch in a strict JSON envelope, with no extra members or prose.',
                            tools, [...projected, {role:'assistant', content:[{type:'text', text:response.text}]}], state, compaction);
                        size = requestSize(request);
                        try {
                            ({response, tokens} = await ask());
                            envelope = parseEnvelope(response.text, tools, seenIds);
                            if (!sameJson(envelope, candidate)) throw Error('Changed correction');
                        } catch {throw Error('Pico response correction failed');}
                    }
                }
                if (envelope.toolCalls.length > bounds.toolCalls - run.usage.toolCalls) limit('Pico tool call limit reached (maximum ' + bounds.toolCalls + ' per turn).');
                for (const c of envelope.toolCalls) seenIds.add(c.id);
                const content = [...(envelope.text ? [{type: 'text', text: envelope.text}] : []), ...envelope.toolCalls.map(c => ({type: 'toolCall', ...c}))];
                const result = message(content, envelope.toolCalls.length ? 'toolUse' : 'stop');
                result.usage = {...emptyUsage(), input: size.tokens, output: tokens, totalTokens: size.tokens + tokens};
                output.push({type: 'done', reason: result.stopReason, message: result});
            } catch (error) {
                const reason = run?.reason || String(error?.message || error);
                output.push({type: 'error', reason: run?.status ? 'aborted' : 'error', error: message([], run?.status ? 'aborted' : 'error', reason)});
            } finally {output.end();}
        })();
        return output;
    };
    const agent = new Agent({initialState: {systemPrompt: system, messages: restored, tools: executableTools,
        model: {id: 'configured', name: 'Configured shared client', api: 'text-envelope', provider: 'shared', baseUrl: '', reasoning: false,
            input: ['text'], cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}, contextWindow: budget.context, maxTokens: budget.reserve}},
        streamFn, toolExecution: 'sequential', identity: {attribution: null},
        beforeToolCall(_context, signal) {
            if (!active || active.status || signal?.aborted) return {block: true, terminate: true, reason: active?.reason || 'Stopped'};
            if (active.usage.toolCalls >= bounds.toolCalls) {stop('limit', 'Pico tool call limit reached.'); return {block: true, terminate: true, reason: active.reason};}
            active.usage.toolCalls++;
        },
        finishTurn: ({message, toolResults}) => {
            if (active?.status) return {action:'end'};
            if (afterStep && !['error','aborted'].includes(message.stopReason)) {
                return afterStep({draftExtracted:active.extracted === true, hasTools:toolResults.length > 0, failedTool:toolResults.some(r=>r.isError),
                    text:message.content.filter(c=>c.type==='text').map(c=>c.text).join('\n')});
            }
        }});
    const unsubscribe = agent.subscribe(event => {
        if (!active || active.status) return;
        if (event.type === 'message_end' && event.message.role === 'assistant') {
            const text = event.message.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
            if (text) emit({type: 'assistant', text});
        } else if (event.type === 'tool_execution_start') emit({type: 'tool', phase: 'start', name: event.toolName, toolCallId: event.toolCallId, args: event.args});
        else if (event.type === 'tool_execution_update') emit({type: 'tool', phase: 'update', name: event.toolName, toolCallId: event.toolCallId, result: event.partialResult.details ?? event.partialResult});
        else if (event.type === 'tool_execution_end') emit({type: 'tool', phase: 'end', name: event.toolName, toolCallId: event.toolCallId, result: event.result.details ?? event.result, isError: event.isError});
    });
    function getMessages() {return copy(agent.state.messages.filter(m => m.role !== 'system'));}
    function prompt(text) {
        if (disposed) throw Error('Pico session is disposed');
        if (active) throw Error('Pico is already running');
        if (typeof text !== 'string' || !text.trim()) throw Error('Pico prompt must be non-empty text');
        const run = {controller: new AbortController(), status: null, reason: null, started: Date.now(),
            usage: {modelCalls: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, compactions: 0, elapsedMs: 0}};
        active = run;
        const timer = setTimeout(() => stop('limit', 'Pico wall time limit reached (maximum ' + bounds.wallMs + ' ms per turn).'), bounds.wallMs);
        return (async () => {
            try {
                await agent.prompt(text);
                if (!run.status && agent.state.errorMessage) {run.status = 'error'; run.reason = agent.state.errorMessage;}
            } catch (error) {run.status ||= 'error'; run.reason ||= String(error?.message || error);}
            finally {
                clearTimeout(timer);
                // Pair repair affects only interrupted calls, never executes anything.
                agent.state.messages = restore(getMessages());
                run.usage.elapsedMs = Date.now() - run.started;
                if (run.status === 'error') emit({type: 'error', message: run.reason});
                const result = {status: run.status || 'complete', messages: getMessages(), usage: {...run.usage}, ...(run.reason ? {reason: run.reason} : {})};
                active = null;
                emit({type: 'done', status: result.status, usage: result.usage});
                return result;
            }
        })();
    }
    return {prompt, abort() {stop('aborted', 'Stopped by user.');}, getMessages,
        dispose() {if (disposed) return; stop('aborted', 'Pico session disposed.'); disposed = true; unsubscribe();}};
}
