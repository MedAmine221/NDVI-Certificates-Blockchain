// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// OpenZeppelin imports for ERC721 NFT
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/utils/Counters.sol";

contract LandCertNFT is ERC721URIStorage {
    using Counters for Counters.Counter;
    Counters.Counter private _tokenIds;

    struct Certificate {
        string terrainId;
        int lat;       // scaled by 1e6
        int lon;       // scaled by 1e6
        int ndvi;      // scaled by 1e4
        string status; // suitability status ("suitable" or "not suitable")
        string date;   // date string
        string cidPdf; // IPFS CID of PDF certificate
        bool exists;   // track existence to avoid duplicates
        bool mintedNFT; // track if NFT minted for this land
    }

    mapping(string => Certificate) private certificates; // terrainId => certificate
    string[] private terrainIds;

    // Map terrainId to tokenId if NFT minted
    mapping(string => uint256) private terrainToTokenId;

    // *** Proper event with indexed fields ***
    event NFTMinted(address indexed owner, uint256 indexed tokenId, string terrainId);

    constructor() ERC721("LandCertificateNFT", "LCERT") {}

    /// Add or update land certificate (no NFT minted here yet)
    function addOrUpdateCertificate(
        string memory _terrainId,
        int _lat,
        int _lon,
        int _ndvi,
        string memory _status,
        string memory _date
    ) public {
        if (!certificates[_terrainId].exists) {
            terrainIds.push(_terrainId);
        }
        certificates[_terrainId] = Certificate({
            terrainId: _terrainId,
            lat: _lat,
            lon: _lon,
            ndvi: _ndvi,
            status: _status,
            date: _date,
            cidPdf: certificates[_terrainId].cidPdf, // keep old CID if any
            exists: true,
            mintedNFT: certificates[_terrainId].mintedNFT
        });
    }

    /// Mint NFT for suitable land only (status must be "suitable")
    function mintNFTForSuitableLand(string memory _terrainId, string memory _cidPdf) public returns (uint256) {
        require(certificates[_terrainId].exists, "Terrain does not exist");
        require(keccak256(bytes(certificates[_terrainId].status)) == keccak256(bytes("suitable")), "Land not suitable");
        require(!certificates[_terrainId].mintedNFT, "NFT already minted for this land");

        _tokenIds.increment();
        uint256 newTokenId = _tokenIds.current();

        _mint(msg.sender, newTokenId);

        // Save CID and mark NFT minted
        certificates[_terrainId].cidPdf = _cidPdf;
        certificates[_terrainId].mintedNFT = true;
        terrainToTokenId[_terrainId] = newTokenId;

        // Set token URI with IPFS gateway + CID
        string memory tokenUri = string(abi.encodePacked("https://gateway.pinata.cloud/ipfs/", _cidPdf));
        _setTokenURI(newTokenId, tokenUri);

        // Emit event with indexed fields for easier filtering
        emit NFTMinted(msg.sender, newTokenId, _terrainId);

        return newTokenId;
    }

    /// Get full certificate data by terrainId
    function getCertificate(string memory _terrainId) public view returns (
        string memory, int, int, int, string memory, string memory, string memory, bool, uint256
    ) {
        Certificate memory cert = certificates[_terrainId];
        uint256 tokenId = 0;
        if (cert.mintedNFT) {
            tokenId = terrainToTokenId[_terrainId];
        }
        return (
            cert.terrainId,
            cert.lat,
            cert.lon,
            cert.ndvi,
            cert.status,
            cert.date,
            cert.cidPdf,
            cert.mintedNFT,
            tokenId
        );
    }

    /// Get all terrain IDs
    function getTerrainIds() public view returns (string[] memory) {
        return terrainIds;
    }

    /// Get tokenId for terrainId NFT (0 if none)
    function getTokenIdByTerrain(string memory _terrainId) public view returns (uint256) {
        require(certificates[_terrainId].exists, "Terrain does not exist");
        return terrainToTokenId[_terrainId];
    }
}
