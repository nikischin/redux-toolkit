import { createAsyncThunk } from './createAsyncThunk'
import { createAction, PayloadAction } from './createAction'
import { createSlice } from './createSlice'
import { configureStore } from './configureStore'
import { createEntityAdapter } from './entities/create_adapter'
import { EntityAdapter } from './entities/models'
import { BookModel } from './entities/fixtures/book'

describe('Combined entity slice', () => {
  let adapter: EntityAdapter<BookModel>

  beforeEach(() => {
    adapter = createEntityAdapter({
      selectId: (book: BookModel) => book.id,
      sortComparer: (a, b) => a.title.localeCompare(b.title)
    })
  })

  it('Entity and async features all works together', async () => {
    const upsertBook = createAction<BookModel>('otherBooks/upsert')

    type BooksState = ReturnType<typeof adapter.getInitialState> & {
      loading: 'initial' | 'pending' | 'finished' | 'failed'
      lastRequestId: string | null
    }

    const initialState: BooksState = adapter.getInitialState({
      loading: 'initial',
      lastRequestId: null
    })

    const fakeBooks: BookModel[] = [
      { id: 'b', title: 'Second' },
      { id: 'a', title: 'First' }
    ]

    const fetchBooksTAC = createAsyncThunk<
      BookModel[],
      void,
      {
        state: { books: BooksState }
      }
    >(
      'books/fetch',
      async (arg, { getState, dispatch, extra, requestId, signal }) => {
        const state = getState()
        return fakeBooks
      }
    )

    const booksSlice = createSlice({
      name: 'books',
      initialState,
      reducers: {
        addOne: adapter.addOne,
        removeOne(state, action: PayloadAction<string>) {
          // TODO The nested `produce` calls don't mutate `state` here as I would have expected.
          // TODO (note that `state` here is actually an Immer Draft<S>, from `createReducer`)
          // TODO However, this works if we _return_ the new plain result value instead
          // TODO See https://github.com/immerjs/immer/issues/533
          const result = adapter.removeOne(state, action)
          return result
        }
      },
      extraReducers: builder => {
        builder.addCase(upsertBook, (state, action) => {
          return adapter.upsertOne(state, action)
        })
        builder.addCase(fetchBooksTAC.pending, (state, action) => {
          state.loading = 'pending'
          state.lastRequestId = action.meta.requestId
        })
        builder.addCase(fetchBooksTAC.fulfilled, (state, action) => {
          if (
            state.loading === 'pending' &&
            action.meta.requestId === state.lastRequestId
          ) {
            return {
              ...adapter.setAll(state, action.payload),
              loading: 'finished',
              lastRequestId: null
            }
          }
        })
      }
    })

    const { addOne, removeOne } = booksSlice.actions
    const { reducer } = booksSlice

    const store = configureStore({
      reducer: {
        books: reducer
      }
    })

    await store.dispatch(fetchBooksTAC())

    const { books: booksAfterLoaded } = store.getState()
    // Sorted, so "First" goes first
    expect(booksAfterLoaded.ids).toEqual(['a', 'b'])
    expect(booksAfterLoaded.lastRequestId).toBe(null)
    expect(booksAfterLoaded.loading).toBe('finished')

    store.dispatch(addOne({ id: 'c', title: 'Middle' }))

    const { books: booksAfterAddOne } = store.getState()

    // Sorted, so "Middle" goes in the middle
    expect(booksAfterAddOne.ids).toEqual(['a', 'c', 'b'])

    store.dispatch(upsertBook({ id: 'c', title: 'Zeroth' }))

    const { books: booksAfterUpsert } = store.getState()

    // Sorted, so "Zeroth" goes last
    expect(booksAfterUpsert.ids).toEqual(['a', 'b', 'c'])
  })
})