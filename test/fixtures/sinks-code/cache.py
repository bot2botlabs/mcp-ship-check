import pickle
def load_cache(path):
    with open(CACHE, 'rb') as fh:
        return pickle.load(fh)
