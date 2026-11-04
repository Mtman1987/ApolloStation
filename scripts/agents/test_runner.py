"""Run against the installed canonical package; provider and tool calls are mocked."""
import copy
import json
import os
import unittest
from bootstrap import DEFAULT_ROOT, install
from openai_runner import SisterRunner, package_path


def completed(text='Ready.'):
    return {'id': 'resp-fixture', 'status': 'completed', 'output': [
        {'type': 'message', 'content': [{'type': 'output_text', 'text': text}]}]}


class RunnerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.package = package_path(os.environ.get('SPMT_AGENT_TEST_ROOT', DEFAULT_ROOT))

    def runner(self, request):
        return SisterRunner(self.package, 'fixture-model', request=request)

    def test_both_personas_use_the_same_runner_with_distinct_instructions(self):
        calls = []
        def request(body):
            calls.append(copy.deepcopy(body))
            return completed()
        runner = self.runner(request)
        for persona in ('athena', 'stella'):
            result = runner.run(persona, 'Who are you?')
            self.assertEqual(result['persona'], persona)
            self.assertEqual(result['package_version'], 'v3.1-repaired')
        self.assertTrue(calls[0]['instructions'].startswith('You are Athena'))
        self.assertTrue(calls[1]['instructions'].startswith('You are Stella'))
        self.assertFalse(calls[0]['store'])

    def test_owner_only_documents_stay_out_of_public_context(self):
        runner = self.runner(lambda body: completed())
        rows = [json.loads(line) for line in (self.package / 'rag/athena_index.jsonl').read_text().splitlines()]
        internal = {row['id'] for row in rows if row['attributes']['audience'] == 'owner'}
        query = 'shared memory BotCard registry shadow send planning implementation'
        private = runner.knowledge('athena', query, {'owner': True, 'surface': 'private'})
        public = runner.knowledge('athena', query, {'owner': True, 'surface': 'public'})
        self.assertTrue(internal.intersection(row['id'] for row in private))
        self.assertFalse(internal.intersection(row['id'] for row in public))

    def test_real_schema_tool_round_trip_and_reasoning_preservation(self):
        requests, rpcs = [], []
        def request(body):
            requests.append(copy.deepcopy(body))
            if len(requests) == 1:
                return {'status': 'completed', 'output': [
                    {'type': 'reasoning', 'id': 'rs-fixture', 'summary': [], 'encrypted_content': 'fixture'},
                    {'type': 'function_call', 'call_id': 'call_balance', 'name': 'spmt_xp_balance',
                     'arguments': json.dumps({'tenantId': 'tenant-a', 'userId': 'user-a'})}]}
            return completed('You have 23 XP.')
        def transport(rpc):
            rpcs.append(rpc)
            return {'jsonrpc': '2.0', 'id': rpc['id'], 'result': {'structuredContent': {'balance': 23}}}
        result = self.runner(request).run('athena', 'My balance?',
            {'tenant_id': 'tenant-a', 'user_id': 'user-a'}, allowed_tools=['spmt_xp_balance'], transport=transport)
        self.assertEqual(rpcs[0]['params']['name'], 'spmt.xp.balance')
        self.assertEqual(result['text'], 'You have 23 XP.')
        self.assertTrue(any(item.get('type') == 'reasoning' for item in requests[1]['input']))
        self.assertEqual(requests[1]['input'][-1]['call_id'], 'call_balance')
        self.assertEqual(json.loads(requests[1]['input'][-1]['output'])['balance'], 23)

    def test_cross_tenant_call_never_reaches_transport(self):
        calls = []
        response = {'status': 'completed', 'output': [{'type': 'function_call', 'call_id': 'call_bad',
                    'name': 'spmt_xp_balance', 'arguments': '{"tenantId":"other","userId":"user-a"}'}]}
        with self.assertRaises(ValueError):
            self.runner(lambda body: response).run('stella', 'Balance',
                {'tenant_id': 'tenant-a', 'user_id': 'user-a'}, allowed_tools=['spmt_xp_balance'],
                transport=lambda rpc: calls.append(rpc))
        self.assertEqual(calls, [])

    def test_uncertain_delivery_is_not_replayed(self):
        calls = []
        def request(body):
            calls.append(body)
            return {'status': 'completed', 'output': [{'type': 'function_call', 'call_id': 'call_1',
                    'name': 'spmt_xp_balance', 'arguments': '{"tenantId":"tenant-a","userId":"user-a"}'}]}
        def transport(rpc):
            raise RuntimeError('Connection lost')
        result = self.runner(request).run('athena', 'Balance',
            {'tenant_id': 'tenant-a', 'user_id': 'user-a'}, allowed_tools=['spmt_xp_balance'], transport=transport)
        self.assertEqual(result['status'], 'tool-outcome-unknown')
        self.assertEqual(len(calls), 1)

    def test_incomplete_response_does_not_claim_success(self):
        result = self.runner(lambda body: {'status': 'incomplete', 'output': []}).run('stella', 'Hello')
        self.assertEqual(result['status'], 'incomplete')
        self.assertEqual(result['text'], '')

    def test_credentials_are_not_forwarded_as_context(self):
        calls = []
        def request(body):
            calls.append(body)
            return completed()
        self.runner(request).run('athena', 'Hello', {'api_key': 'must-stay-out', 'access_token': 'also-private'})
        self.assertNotIn('must-stay-out', json.dumps(calls))
        self.assertNotIn('also-private', json.dumps(calls))

    def test_unknown_persona_rejected_before_request(self):
        calls = []
        with self.assertRaises(ValueError):
            self.runner(lambda body: calls.append(body)).run('../athena', 'Hello')
        self.assertEqual(calls, [])


if __name__ == '__main__':
    unittest.main()
