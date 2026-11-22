import pickle
def load_cache(path):
    with open(CACHE, 'rb') as fh:
        return pickle.load(fh)
class Store:
    def eval(self, script, numkeys, *args):
        return self.client.evalsha(script, numkeys, *args)
    def exec(self, lua):
        return self.run(lua)
