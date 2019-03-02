const fetch = require('node-fetch')
const {
    httpsFunctions,
    db,
    isSupportedUrl,
    documentIdFromHashOrUrl,
    collection,
    normalizeUrl,
    urlFor,
    domainOf,
    getConfig,
    getUserFromToken,
    resError
} = require('../utils')
const FieldValue = require('firebase-admin').firestore.FieldValue
const {
    getProductInfoFromUrl,
    validateUrlPath
} = require('../utils/parser/utils')

const ADMIN_TOKEN = getConfig('admin_token')

const { text: { ERR_URL_NOT_SUPPORTED } } = require('../utils/constants')

module.exports = httpsFunctions.onRequest(async (req, res) => {
    // TODO: Add limit, paging
    let url = req.query.url
    const idToken = req.query.idToken
    const authUser = await getUserFromToken(idToken)

    if (!idToken || authUser === null) return resError(res, `Invalid Token ${uid}`)

    try {
        url = normalizeUrl(url)
    } catch (err) {
        console.error(err)
        return resError(res, ERR_URL_NOT_SUPPORTED)
    }

    // User email
    const email = authUser.email

    // Url is not supported
    if (!isSupportedUrl(url)) return resError(res, ERR_URL_NOT_SUPPORTED)

    // Validate valid url
    if (!validateUrlPath(url)) {
        console.log('validateUrlPath(url)', validateUrlPath(url), url)
        return resError(res, ERR_URL_NOT_SUPPORTED)
    }

    let info = await getProductInfoFromUrl(url) || {}
    let urlDoc = db.collection(collection.URLS).doc(documentIdFromHashOrUrl(url))

    // Fetch the first data
    const pullDataUrl = urlFor('pullData', {
        region: 'asia',
        url: url,
        token: ADMIN_TOKEN
    })

    urlDoc.get().then(snapshot => {
        if (snapshot.exists) {
            // Subscribe email
            urlDoc.collection(collection.SUBSCRIBE).doc(email).set({
                email,
                active: false,
                create_at: new Date()
            }, {
                merge: true
            })

            // Update info
            let data = snapshot.data()
            data['number_of_add'] = (snapshot.get('number_of_add') || 0) + 1
            data['raw_count'] = snapshot.get('raw_count') || 0
            data['last_update_at'] = FieldValue.serverTimestamp()
            data['info'] = info
            urlDoc.set(data, {
                merge: true
            }).then(() => {
                data['is_update'] = true
                return res.json({
                    id: snapshot.id,
                    ...data
                })
            })

            fetch(pullDataUrl)
            console.log(`update data ${pullDataUrl}`)

            return true
        }

        urlDoc.set({
                url,
                domain: domainOf(url),
                info,
                number_of_add: 1, // How many time this url is added?
                raw_count: 0,
                created_at: FieldValue.serverTimestamp(),
                last_pull_at: null,
                add_by: email,
            }, {
                merge: true
            })
            .then(() => {
                // Update Metadata
                let statisticDoc = db.collection(collection.METADATA).doc('statistics')
                statisticDoc.get().then(doc => {
                    const url_count = parseInt(doc.get('url_count') || 0) + 1;
                    statisticDoc.set({
                        url_count
                    }, {
                        merge: true
                    })
                })

                // Subscribe email
                urlDoc.collection(collection.SUBSCRIBE).doc(email).set({
                    email,
                    active: true,
                    expect_when: 'down',
                    expect_price: 0,
                    methods: 'email',
                    create_at: new Date()
                }, {
                    merge: true
                })

                fetch(pullDataUrl)
                console.log(`Fetch the first data ${pullDataUrl}`)

                // Response
                urlDoc.get().then(snapshot => res.json({
                    id: snapshot.id,
                    ...snapshot.data()
                }))
            })
            .catch(err => {
                return res.status(400).json(err)
            })

    })
})