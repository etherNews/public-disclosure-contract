import React, { useState, useEffect } from 'react';
import Web3 from 'web3';
import PublicDisclosureContract from './contracts/PublicDisclosure.json';
import './App.css';

function App() {
  const [web3, setWeb3] = useState(null);
  const [account, setAccount] = useState('');
  const [contract, setContract] = useState(null);
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [formData, setFormData] = useState({
    title: '',
    content: '',
    link: '',
    fee: '0.01'
  });
  const [removePostId, setRemovePostId] = useState('');
  const [paymentReceiver, setPaymentReceiver] = useState('');
  const [removeFee, setRemoveFee] = useState('');
  const [renewPostId, setRenewPostId] = useState('');
  const [renewFee, setRenewFee] = useState('');
  const [showCleanupButton, setShowCleanupButton] = useState(false);
  const [cleanupInProgress, setCleanupInProgress] = useState(false);

  useEffect(() => {
    const init = async () => {
      // Connect to Web3
      if (window.ethereum) {
        try {
          await window.ethereum.request({ method: 'eth_requestAccounts' });
          const web3Instance = new Web3(window.ethereum);
          setWeb3(web3Instance);
          
          const accounts = await web3Instance.eth.getAccounts();
          setAccount(accounts[0]);
          
          // Load contract
          const networkId = await web3Instance.eth.net.getId();
          const deployedNetwork = PublicDisclosureContract.networks[networkId];
          const contractInstance = new web3Instance.eth.Contract(
            PublicDisclosureContract.abi,
            deployedNetwork && deployedNetwork.address
          );
          
          setContract(contractInstance);
          
          // Check if user is admin to show cleanup button
          const admin = await contractInstance.methods.admin().call();
          setShowCleanupButton(accounts[0].toLowerCase() === admin.toLowerCase());
          
          loadPosts(contractInstance, 0);
        } catch (error) {
          console.error("Could not connect to wallet", error);
        }
      } else {
        alert("Please install MetaMask!");
      }
    };
    
    init();
  }, []);

  const loadPosts = async (contractInstance, page) => {
    setLoading(true);
    try {
      // Get paginated active post IDs
      const result = await contractInstance.methods.getActivePostIds(page).call();
      const activePostIds = result[0];
      const totalPages = parseInt(result[1]);
      setTotalPages(totalPages);
      
      if (activePostIds.length === 0) {
        setPosts([]);
        setLoading(false);
        return;
      }
      
      // Get posts data in batch
      const batchData = await contractInstance.methods.getPostsBatch(activePostIds).call();
      
      // Get post content for each post (separate call to save gas)
      const contentPromises = activePostIds.map(id => 
        contractInstance.methods.getPostContent(id).call()
      );
      const contents = await Promise.all(contentPromises);
      
      // Combine the data
      const postsData = activePostIds.map((id, index) => ({
        id,
        author: batchData.authors[index],
        title: batchData.titles[index],
        content: contents[index].content,
        link: contents[index].link,
        publicationFee: web3.utils.fromWei(batchData.fees[index], 'ether'),
        expiryTime: new Date(batchData.expiryTimes[index] * 1000).toLocaleString(),
        isActive: batchData.activeStates[index]
      }));
      
      // Sort by fee (highest first)
      postsData.sort((a, b) => parseFloat(b.publicationFee) - parseFloat(a.publicationFee));
      
      setPosts(postsData);
    } catch (error) {
      console.error("Error loading posts", error);
    }
    setLoading(false);
  };

  const handlePageChange = (newPage) => {
    setCurrentPage(newPage);
    loadPosts(contract, newPage);
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });
  };

  const handlePublishPost = async (e) => {
    e.preventDefault();
    
    try {
      const { title, content, link, fee } = formData;
      const weiValue = web3.utils.toWei(fee, 'ether');
      
      await contract.methods.publishPost(title, content, link)
        .send({ from: account, value: weiValue });
      
      // Reset form
      setFormData({
        title: '',
        content: '',
        link: '',
        fee: '0.01'
      });
      
      // Reload posts
      loadPosts(contract, currentPage);
    } catch (error) {
      console.error("Error publishing post", error);
    }
  };

  const handleRemovePost = async (e) => {
    e.preventDefault();
    
    try {
      const weiValue = web3.utils.toWei(removeFee, 'ether');
      
      await contract.methods.removePost(removePostId, paymentReceiver)
        .send({ from: account, value: weiValue });
      
      // Reset form
      setRemovePostId('');
      setPaymentReceiver('');
      setRemoveFee('');
      
      // Reload posts
      loadPosts(contract, currentPage);
    } catch (error) {
      console.error("Error removing post", error);
    }
  };

  const handleRenewPost = async (e) => {
    e.preventDefault();
    
    try {
      const weiValue = web3.utils.toWei(renewFee, 'ether');
      
      await contract.methods.renewPost(renewPostId)
        .send({ from: account, value: weiValue });
      
      // Reset form
      setRenewPostId('');
      setRenewFee('');
      
      // Reload posts
      loadPosts(contract, currentPage);
    } catch (error) {
      console.error("Error renewing post", error);
    }
  };

  const handleCleanupExpired = async () => {
    try {
      setCleanupInProgress(true);
      
      // Cleanup up to 20 expired posts at once
      await contract.methods.cleanupExpiredPosts(20)
        .send({ from: account });
      
      // Reload posts
      loadPosts(contract, currentPage);
      
      setCleanupInProgress(false);
    } catch (error) {
      console.error("Error cleaning up posts", error);
      setCleanupInProgress(false);
    }
  };

  const donateToAuthor = async (authorAddress, amount) => {
    try {
      const weiValue = web3.utils.toWei(amount, 'ether');
      
      await web3.eth.sendTransaction({
        from: account,
        to: authorAddress,
        value: weiValue
      });
      
      alert("Donation sent successfully!");
    } catch (error) {
      console.error("Error sending donation", error);
    }
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>Public Disclosure Platform</h1>
        {account && (
          <p>Connected: {account}</p>
        )}
        {showCleanupButton && (
          <button 
            onClick={handleCleanupExpired}
            disabled={cleanupInProgress}
            className="cleanup-button"
          >
            {cleanupInProgress ? "Processing..." : "Cleanup Expired Posts"}
          </button>
        )}
      </header>
      
      <main>
        <section className="publish-section">
          <h2>Publish New Post</h2>
          <form onSubmit={handlePublishPost}>
            <div className="form-group">
              <label>Title:</label>
              <input 
                type="text" 
                name="title" 
                value={formData.title} 
                onChange={handleInputChange} 
                required 
              />
            </div>
            
            <div className="form-group">
              <label>Content:</label>
              <textarea 
                name="content" 
                value={formData.content} 
                onChange={handleInputChange} 
                required 
              />
            </div>
            
            <div className="form-group">
              <label>Related Link:</label>
              <input 
                type="url" 
                name="link" 
                value={formData.link} 
                onChange={handleInputChange} 
              />
            </div>
            
            <div className="form-group">
              <label>Publication Fee (ETH):</label>
              <input 
                type="number" 
                name="fee" 
                min="0.01" 
                step="0.01" 
                value={formData.fee} 
                onChange={handleInputChange} 
                required 
              />
            </div>
            
            <button type="submit">Publish</button>
          </form>
        </section>
        
        <section className="remove-section">
          <h2>Remove Post</h2>
          <form onSubmit={handleRemovePost}>
            <div className="form-group">
              <label>Post ID:</label>
              <input 
                type="number" 
                value={removePostId} 
                onChange={(e) => setRemovePostId(e.target.value)} 
                required 
              />
            </div>
            
            <div className="form-group">
              <label>Payment Receiver (Author or Admin):</label>
              <input 
                type="text" 
                value={paymentReceiver} 
                onChange={(e) => setPaymentReceiver(e.target.value)} 
                required 
              />
            </div>
            
            <div className="form-group">
              <label>Fee (ETH):</label>
              <input 
                type="number" 
                min="0.01" 
                step="0.01" 
                value={removeFee} 
                onChange={(e) => setRemoveFee(e.target.value)} 
                required 
              />
            </div>
            
            <button type="submit">Remove</button>
          </form>
        </section>
        
        <section className="renew-section">
          <h2>Renew Post</h2>
          <form onSubmit={handleRenewPost}>
            <div className="form-group">
              <label>Post ID:</label>
              <input 
                type="number" 
                value={renewPostId} 
                onChange={(e) => setRenewPostId(e.target.value)} 
                required 
              />
            </div>
            
            <div className="form-group">
              <label>Fee (ETH):</label>
              <input 
                type="number" 
                min="0.01" 
                step="0.01" 
                value={renewFee} 
                onChange={(e) => setRenewFee(e.target.value)} 
                required 
              />
            </div>
            
            <button type="submit">Renew</button>
          </form>
        </section>
        
        <section className="posts-section">
          <h2>Active Posts</h2>
          {loading ? (
            <p>Loading posts...</p>
          ) : (
            <>
              {posts.length === 0 ? (
                <p>No active posts found.</p>
              ) : (
                <div className="posts-grid">
                  {posts.map((post) => (
                    <div key={post.id} className="post-card">
                      <h3>{post.title}</h3>
                      <p className="post-content">{post.content}</p>
                      {post.link && (
                        <p>
                          <a href={post.link} target="_blank" rel="noopener noreferrer">
                            Related Link
                          </a>
                        </p>
                      )}
                      <div className="post-meta">
                        <p>Post ID: {post.id}</p>
                        <p>Author: {post.author}</p>
                        <p>Fee: {post.publicationFee} ETH</p>
                        <p>Expires: {post.expiryTime}</p>
                      </div>
                      <div className="post-actions">
                        <button onClick={() => {
                          const amount = prompt("Enter donation amount in ETH:");
                          if (amount) {
                            donateToAuthor(post.author, amount);
                          }
                        }}>
                          Donate to Author
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              
              {totalPages > 1 && (
                <div className="pagination">
                  <button 
                    onClick={() => handlePageChange(Math.max(0, currentPage - 1))}
                    disabled={currentPage === 0}
                  >
                    Previous
                  </button>
                  <span>Page {currentPage + 1} of {totalPages}</span>
                  <button 
                    onClick={() => handlePageChange(Math.min(totalPages - 1, currentPage + 1))}
                    disabled={currentPage === totalPages - 1}
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;